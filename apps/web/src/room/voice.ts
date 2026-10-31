import { reactive } from 'vue';
import { offersTo, ROOM_VOICE_LIMITS, type RoomSignalsInput, type RoomSignalView, type RoomVoiceView } from 'ustp-domain';
import { ApiError } from '../api.js';
import { joinVoice, leaveVoice, sendSignals, updateVoice } from './api.js';
import { rms, SpeakingDetector } from './speaking.js';

/**
 * The room's call (design §5.10), peer to peer: this page sends the member's microphone straight to every other page in
 * the call and plays what each sends back, over WebRTC (encrypted end to end between each pair). The api only says who
 * is in the call and passes each pair's offer and answer, whole (no trickled candidates), so a pair needs two messages.
 * In each pair the page that joined later offers. Who is speaking is worked out here from the sound itself.
 */

export type PeerState = 'connecting' | 'connected' | 'failed';

/** A connection that has not connected this long after its offer is tried again, this many times. */
const CONNECT_MS = 15_000;
const ATTEMPTS = 3;
/** How long a page waits for its network addresses before sending its half of a handshake with those it has. */
const GATHER_MS = 3_000;
const METER_MS = 100;

type Signal = RoomSignalsInput['signals'][number];

/** A level meter on a stream. */
class Meter {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  readonly detector = new SpeakingDetector();

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    // Measured only: what the page plays goes through an <audio> element.
    this.source.connect(this.analyser);
  }

  speaking(now: number): boolean {
    this.analyser.getFloatTimeDomainData(this.samples);
    return this.detector.update(rms(this.samples), now);
  }

  stop(): void {
    this.source.disconnect();
  }
}

interface Peer {
  readonly accountId: string;
  /** Their page in the call. */
  readonly session: string;
  /** This page makes the offer (it joined later). */
  readonly offerer: boolean;
  pc: RTCPeerConnection | null;
  audio: HTMLAudioElement | null;
  meter: Meter | null;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Resolves once the connection has its network addresses, or after `GATHER_MS` with those it found. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface VoiceHooks {
  /** The page is out of the call without the member leaving it: they joined from another page, or left the room. */
  dropped(reason: string): void;
}

export class VoiceCall {
  /** What the voice bar shows. */
  readonly state = reactive({
    joining: false,
    sessionId: null as string | null,
    muted: false,
    /** By account, the member's own included: speaking now, as heard here. */
    speaking: {} as Record<string, boolean>,
    /** By account: this page's connection to them. */
    peers: {} as Record<string, PeerState>,
    /** The member is talking while muted. */
    mutedTalking: false,
  });

  private myId = '';
  private myJoinedAt = '';
  private voiceSeq = -1;
  private joinSeq = 0;
  private local: MediaStream | null = null;
  private metered: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localMeter: Meter | null = null;
  private iceServers: RTCIceServer[] = [];
  private readonly peers = new Map<string, Peer>();
  private readonly seen = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private metering: ReturnType<typeof setInterval> | undefined;
  private rejoining = false;

  constructor(private readonly hooks: VoiceHooks) {}

  get joined(): boolean {
    return this.state.sessionId !== null;
  }

  get sessionId(): string | null {
    return this.state.sessionId;
  }

  /** The feed number this page joined at: handshakes to it all come after. */
  get joinedSeq(): number {
    return this.joinSeq;
  }

  /**
   * Joins from this page: asks for the microphone first (a member who refuses it never joins), then calls everyone in
   * the call. Call it from the click itself, so the browser lets the page play sound. Returns who is in the call.
   */
  async join(): Promise<{ voice: readonly RoomVoiceView[]; voiceSeq: number }> {
    if (this.joined || this.state.joining) throw new Error('already in the call');
    this.state.joining = true;
    // Made before anything is awaited, inside the click, so it may play.
    this.ctx = new AudioContext();
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      for (const t of this.local.getAudioTracks()) t.enabled = !this.state.muted;
      await this.ctx.resume();
      // Measured from a copy that muting leaves on, so the bar can say when the member talks while muted.
      const copies = this.local.getAudioTracks().map((t) => t.clone());
      for (const c of copies) c.enabled = true;
      this.metered = new MediaStream(copies);
      this.localMeter = new Meter(this.ctx, this.metered);
      const joined = await this.enter();
      this.metering = setInterval(() => this.measure(), METER_MS);
      this.heartbeat = setInterval(() => void this.beat(), ROOM_VOICE_LIMITS.heartbeatSeconds * 1000);
      return joined;
    } catch (e) {
      this.end();
      throw e;
    } finally {
      this.state.joining = false;
    }
  }

  /** Joins (again) with a new session, and calls everyone in the call. */
  private async enter(): Promise<{ voice: readonly RoomVoiceView[]; voiceSeq: number }> {
    const joined = await joinVoice(this.state.muted);
    this.closePeers();
    this.iceServers = joined.iceServers.map((s) => ({ urls: [...s.urls] }));
    this.state.sessionId = joined.sessionId;
    this.joinSeq = joined.voiceSeq;
    this.voiceSeq = -1;
    this.apply(joined.voice, joined.voiceSeq);
    return joined;
  }

  /** Leaves the call. `unloading` when the tab is closing: the request is sent so that it outlives the page. */
  leave(unloading = false): void {
    const session = this.state.sessionId;
    this.end();
    if (session) void leaveVoice(session, unloading).catch(() => undefined);
  }

  async setMuted(muted: boolean): Promise<void> {
    this.state.muted = muted;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !muted;
    if (this.joined) await this.beat();
  }

  /**
   * Who is in the call (from an update, numbered `voiceSeq`; older lists are ignored): calls those this page should,
   * and drops those who left or are in it from another page now.
   */
  apply(voice: readonly RoomVoiceView[], voiceSeq: number): void {
    if (!this.joined || voiceSeq < this.voiceSeq) return;
    this.voiceSeq = voiceSeq;
    const me = voice.find((v) => v.mine);
    if (!me) {
      // Dropped while this page was quiet (a sleeping laptop): back in, with a new session.
      void this.rejoin();
      return;
    }
    if (me.sessionId !== this.state.sessionId) {
      this.end();
      this.hooks.dropped('You joined the call from another page, so this one left it.');
      return;
    }
    this.myId = me.accountId;
    this.myJoinedAt = me.joinedAt;
    const others = new Map(voice.filter((v) => !v.mine).map((v) => [v.accountId, v]));
    for (const [id, peer] of this.peers) {
      if (others.get(id)?.sessionId !== peer.session) this.drop(peer);
    }
    const calls: Peer[] = [];
    for (const v of others.values()) {
      if (this.peers.has(v.accountId)) continue;
      const peer: Peer = {
        accountId: v.accountId,
        session: v.sessionId,
        offerer: offersTo({ accountId: this.myId, joinedAt: this.myJoinedAt }, v),
        pc: null,
        audio: null,
        meter: null,
        attempts: 0,
        timer: undefined,
      };
      this.peers.set(v.accountId, peer);
      this.state.peers[v.accountId] = 'connecting';
      if (peer.offerer) calls.push(peer);
    }
    if (calls.length) void this.call(calls);
  }

  /** Handshakes sent to this page (from an update). */
  async receive(signals: readonly RoomSignalView[]): Promise<void> {
    for (const s of signals) {
      if (this.seen.has(s.signalId)) continue;
      this.seen.add(s.signalId);
      const peer = this.peers.get(s.from);
      // From a page no longer in the call, or one this page calls itself.
      if (!peer || peer.session !== s.fromSession) continue;
      try {
        if (s.kind === 'offer' && !peer.offerer) await this.answer(peer, s.sdp);
        else if (s.kind === 'answer' && peer.offerer && peer.pc?.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        }
      } catch {
        // A handshake that does not fit (an old one, a page reloaded): the offerer's timer tries again.
      }
    }
  }

  /** Offers to each of `peers`, sent together. */
  private async call(peers: readonly Peer[]): Promise<void> {
    // An offer that cannot be made (a connection closed meanwhile) is left to the timer.
    const offers = (await Promise.all(peers.map((p) => this.offer(p).catch(() => null)))).filter((s): s is Signal => !!s);
    await this.send(offers);
  }

  private async offer(peer: Peer): Promise<Signal | null> {
    const pc = this.connect(peer);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (peer.pc !== pc || !pc.localDescription) return null;
    clearTimeout(peer.timer);
    peer.timer = setTimeout(() => this.retry(peer, pc), CONNECT_MS);
    return { to: peer.accountId, toSession: peer.session, kind: 'offer', sdp: pc.localDescription.sdp };
  }

  private async answer(peer: Peer, sdp: string): Promise<void> {
    const pc = this.connect(peer);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    if (peer.pc !== pc || !pc.localDescription) return;
    await this.send([{ to: peer.accountId, toSession: peer.session, kind: 'answer', sdp: pc.localDescription.sdp }]);
  }

  private async send(signals: Signal[]): Promise<void> {
    const session = this.state.sessionId;
    if (!signals.length || !session) return;
    try {
      await sendSignals(session, signals);
    } catch {
      // Someone left meanwhile (409), or the network: the next list of who is in the call, or the timer, sorts it out.
    }
  }

  /** A fresh connection to `peer`, replacing any before, carrying the microphone. */
  private connect(peer: Peer): RTCPeerConnection {
    peer.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const t of this.local?.getAudioTracks() ?? []) pc.addTrack(t, this.local!);
    pc.ontrack = (e) => {
      if (peer.pc === pc) this.hear(peer, e.streams[0] ?? new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (peer.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(peer.timer);
        peer.attempts = 0;
        this.state.peers[peer.accountId] = 'connected';
      } else if (s === 'failed') {
        if (peer.offerer) this.retry(peer, pc);
        else this.state.peers[peer.accountId] = 'connecting';
      } else if (s === 'disconnected') {
        this.state.peers[peer.accountId] = 'connecting';
        // It may come back by itself; if not, the offerer starts again.
        if (peer.offerer) {
          clearTimeout(peer.timer);
          peer.timer = setTimeout(() => this.retry(peer, pc), CONNECT_MS);
        }
      }
    };
    peer.pc = pc;
    return pc;
  }

  /** The offerer starts a connection that did not connect again, up to `ATTEMPTS` times. */
  private retry(peer: Peer, pc: RTCPeerConnection): void {
    if (peer.pc !== pc || pc.connectionState === 'connected' || this.peers.get(peer.accountId) !== peer) return;
    if (++peer.attempts >= ATTEMPTS) {
      clearTimeout(peer.timer);
      this.state.peers[peer.accountId] = 'failed';
      return;
    }
    this.state.peers[peer.accountId] = 'connecting';
    void this.call([peer]);
  }

  /** Plays what `peer` sends, and measures it for the ring around their name. */
  private hear(peer: Peer, stream: MediaStream): void {
    peer.audio ??= new Audio();
    peer.audio.autoplay = true;
    peer.audio.srcObject = stream;
    void peer.audio.play().catch(() => undefined);
    peer.meter?.stop();
    // Chrome measures a remote stream only while an <audio> element plays it too, as this one does.
    peer.meter = this.ctx ? new Meter(this.ctx, stream) : null;
  }

  private measure(): void {
    const now = performance.now();
    const loud = this.localMeter?.speaking(now) ?? false;
    this.set(this.myId, loud && !this.state.muted);
    if (this.state.mutedTalking !== (loud && this.state.muted)) this.state.mutedTalking = loud && this.state.muted;
    for (const p of this.peers.values()) this.set(p.accountId, p.meter?.speaking(now) ?? false);
  }

  private set(accountId: string, speaking: boolean): void {
    if (accountId && (this.state.speaking[accountId] ?? false) !== speaking) this.state.speaking[accountId] = speaking;
  }

  /** Tells the api the page is still in the call, muted or not; out of it, joins again or gives up. */
  private async beat(): Promise<void> {
    const session = this.state.sessionId;
    if (!session) return;
    try {
      await updateVoice(session, this.state.muted);
    } catch (e) {
      if (!(e instanceof ApiError) || session !== this.state.sessionId) return;
      if (e.status === 409) await this.rejoin();
      else if (e.status === 403) {
        this.end();
        this.hooks.dropped('You are no longer in the room, so you left the call.');
      }
    }
  }

  private async rejoin(): Promise<void> {
    if (this.rejoining || !this.joined) return;
    this.rejoining = true;
    try {
      await this.enter();
    } catch (e) {
      this.end();
      this.hooks.dropped(`You were dropped from the call${e instanceof Error ? `: ${e.message}` : ''}.`);
    } finally {
      this.rejoining = false;
    }
  }

  private drop(peer: Peer): void {
    clearTimeout(peer.timer);
    peer.pc?.close();
    peer.meter?.stop();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio = null;
    }
    this.peers.delete(peer.accountId);
    delete this.state.peers[peer.accountId];
    delete this.state.speaking[peer.accountId];
  }

  private closePeers(): void {
    for (const peer of [...this.peers.values()]) this.drop(peer);
  }

  /** Out of the call here: connections closed, the microphone released. */
  private end(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.metering);
    this.closePeers();
    this.localMeter?.stop();
    this.localMeter = null;
    for (const t of [...(this.local?.getTracks() ?? []), ...(this.metered?.getTracks() ?? [])]) t.stop();
    this.local = null;
    this.metered = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.state.sessionId = null;
    this.state.speaking = {};
    this.state.peers = {};
    this.state.mutedTalking = false;
    this.seen.clear();
    this.voiceSeq = -1;
  }
}
