import type { CourseLesson, CourseRecord, FuturistProfile } from 'ustp-domain';
import { FIRST_COURSE_POSITION } from './course-map-seed.js';

const COURSE_ID = 'transhumanism';
const SOURCE = 'course-seed';
const UPDATED_AT = '2026-10-28T00:00:00.000Z';

const question = (questionId: string, prompt: string, choices: readonly string[], correctIndex: number, explanation: string) => ({
  questionId,
  prompt,
  choices,
  correctIndex,
  explanation,
});

/** The starter curriculum is deliberately pluralistic: it teaches advocacy, governance, and critique together. */
export const transhumanismCourse: CourseRecord = {
  courseId: COURSE_ID,
  title: 'Transhumanism: Human Flourishing and Democratic Futures',
  summary:
    'A six-lesson introduction to enhancement, longevity, AI, democracy, and the ethical choices that shape technological futures.',
  status: 'published',
  version: 1,
  publishedVersion: 1,
  prerequisites: [],
  position: FIRST_COURSE_POSITION,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  updatedBy: SOURCE,
};

export const transhumanismLessons: readonly CourseLesson[] = [
  {
    courseId: COURSE_ID,
    lessonId: 'foundations',
    order: 1,
    title: 'Foundations: What is transhumanism?',
    summary: 'Learn the basic terms and distinguish transhumanism from adjacent traditions.',
    body:
      'Transhumanism is a family of ideas about using science and technology to expand healthy human capacities. Its supporters commonly discuss preventing disease, reducing suffering, extending healthy life, and giving people more control over their bodies and minds.\n\nIt is not a single political program. Democratic transhumanists stress equal access, democratic governance, and rights. Other currents emphasize personal freedom, market experimentation, or long-term risk. A careful learner separates a person’s aspiration from the institutions needed to pursue it fairly.\n\nPosthumanism, humanism, disability justice, and bioconservatism overlap with this conversation while asking different questions. The course will use those differences as tools for clearer thinking rather than labels for teams.',
    estimatedMinutes: 12,
    questions: [
      question('f1', 'Which statement best describes transhumanism?', ['A single prediction that AI will replace people', 'A family of ideas about using technology to expand human capacities', 'A requirement to alter every human body', 'A political party platform'], 1, 'Transhumanism is a broad set of ideas, not one technology or political program.'),
      question('f2', 'Which concern is central to democratic transhumanism?', ['Keeping technology available only to experts', 'Equal access, rights, and democratic oversight', 'Avoiding all biomedical research', 'Replacing public discussion with algorithms'], 1, 'Democratic approaches ask who benefits, who decides, and how harms are addressed.'),
      question('f3', 'Which is an example of an enhancement-adjacent technology?', ['A hearing aid', 'A paper ballot box', 'A highway sign', 'A wooden chair'], 0, 'Assistive technologies such as hearing aids are useful starting points for discussing capability and access.'),
      question('f4', 'Why does this course include critics of transhumanism?', ['To make every lesson harder', 'To identify power, equity, consent, and safety concerns', 'Because critics reject all technology', 'To decide the future has already happened'], 1, 'Ethical disagreement helps learners test claims rather than merely repeat them.'),
      question('f5', 'What is the most responsible way to discuss a proposed enhancement?', ['Promise it will solve every problem', 'Consider evidence, benefits, harms, access, and consent', 'Assume only wealthy users matter', 'Avoid asking affected people'], 1, 'Responsible innovation considers both technical evidence and social consequences.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
  {
    courseId: COURSE_ID,
    lessonId: 'principles',
    order: 2,
    title: 'Ideas and principles',
    summary: 'Explore autonomy, human flourishing, justice, privacy, and long-term responsibility.',
    body:
      'Technology can increase choice, but only when people have meaningful consent and practical access. Morphological freedom—the ability to make informed decisions about one’s body—is often paired with duties to prevent coercion, discrimination, and exploitation.\n\nHuman flourishing asks more than whether a tool is possible. It asks whether people can live healthier, more capable, connected, and self-directed lives. Equity asks whether benefits and risks are distributed fairly across income, race, disability, gender, nationality, and generation.\n\nPrivacy, transparency, and democratic accountability are essential when technologies collect biological data or make consequential decisions. Long-term stewardship means considering harms that may outlast a product launch or an election cycle.',
    estimatedMinutes: 12,
    questions: [
      question('p1', 'What does meaningful consent require?', ['A person is informed and can freely choose', 'A person is pressured to accept a tool', 'A company hides the risks', 'A tool is inexpensive'], 0, 'Consent must be informed and voluntary.'),
      question('p2', 'Why is equity relevant to enhancement?', ['Only early adopters need protection', 'Unequal access can widen existing social gaps', 'Technology never changes institutions', 'It eliminates the need for public policy'], 1, 'Benefits and risks can amplify inequality without intentional access and governance.'),
      question('p3', 'Which principle addresses misuse of personal biological data?', ['Privacy', 'Novelty', 'Speed', 'Celebrity'], 0, 'Privacy protects information about bodies, identities, and choices.'),
      question('p4', 'Long-term stewardship means:', ['Considering future consequences and responsibilities', 'Ignoring people who are not yet customers', 'Publishing faster than competitors', 'Treating every risk as impossible'], 0, 'Stewardship asks present decision-makers to consider durable effects.'),
      question('p5', 'Which policy most supports democratic governance?', ['Closed decisions by a vendor', 'Public input, accountability, and independent review', 'Permanent secrecy for every system', 'Removing appeal rights'], 1, 'Democratic governance creates meaningful ways to question and improve decisions.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
  {
    courseId: COURSE_ID,
    lessonId: 'technologies',
    order: 3,
    title: 'Technologies: health, AI, and augmentation',
    summary: 'Examine longevity science, biotechnology, neurotechnology, and AI without hype.',
    body:
      'Biotechnology may improve prevention, diagnosis, organ replacement, and treatment. Longevity research asks how people can remain healthy for longer, but it does not make a guarantee of radical life extension.\n\nNeurotechnology can restore or augment communication, movement, and perception. It also raises difficult questions about brain data, identity, security, and voluntary participation.\n\nAI can help discover medicines, translate languages, and support decisions. It can also encode bias, concentrate power, or produce unreliable outputs. Technical capability is not a substitute for clinical evidence, human judgment, or accountable institutions.',
    estimatedMinutes: 14,
    questions: [
      question('t1', 'Which is a responsible claim about longevity science?', ['It guarantees immortality today', 'It studies ways to extend healthy life and reduce disease', 'It has no connection to medicine', 'It removes the need for evidence'], 1, 'Longevity research concerns health and aging; extraordinary claims need strong evidence.'),
      question('t2', 'What is a key concern with neurotechnology?', ['Brain-data privacy and voluntary consent', 'Whether people can use pencils', 'The color of a device case', 'Eliminating all accessibility tools'], 0, 'Neural data can be uniquely sensitive and requires strong safeguards.'),
      question('t3', 'Why can AI require independent review?', ['It is always correct', 'It can be biased, unreliable, or used without accountability', 'It cannot process information', 'It makes laws unnecessary'], 1, 'Review provides checks on high-impact automated decisions.'),
      question('t4', 'What should happen before a health technology is broadly adopted?', ['Evidence, safety review, and informed consent', 'A viral marketing campaign only', 'A promise from an influencer', 'No testing'], 0, 'Clinical and social evidence are necessary before broad deployment.'),
      question('t5', 'An assistive technology lens asks:', ['How a tool can increase agency and participation', 'How to eliminate user choice', 'How to make disability invisible', 'How to avoid accessibility'], 0, 'Assistive technology can improve agency when designed with users.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
  {
    courseId: COURSE_ID,
    lessonId: 'democracy',
    order: 4,
    title: 'Democracy, access, and governance',
    summary: 'Connect innovation to public institutions, access, and accountability.',
    body:
      'A democratic approach does not assume that a technology is good merely because it is new. It asks who is represented in research, who has access, who bears risk, and what recourse exists when a system causes harm.\n\nPublic investment, interoperable standards, accessibility, consumer protection, and independent science can all shape whether innovation serves a broad public. Governance should be adaptive: rules must evolve with evidence while remaining understandable and contestable.\n\nGlobal questions matter. A treatment, climate technology, or AI system can affect people far beyond the country that first developed it. Democratic futures require international cooperation as well as local participation.',
    estimatedMinutes: 12,
    questions: [
      question('d1', 'What question helps evaluate fair access?', ['Who can benefit and who might be excluded?', 'Which company has the loudest advertisement?', 'How quickly can debate be ended?', 'Whether a product has a futuristic name'], 0, 'Access is about distribution, not only technical capability.'),
      question('d2', 'What is recourse in technology governance?', ['A way to challenge or appeal a harmful decision', 'A marketing discount', 'A secret password', 'A ban on feedback'], 0, 'People need usable ways to seek correction when systems harm them.'),
      question('d3', 'Why should governance be adaptive?', ['Evidence and technology can change over time', 'Rules should never be reviewed', 'Only one country is affected', 'Public input is irrelevant'], 0, 'Rules should respond to new evidence while retaining accountability.'),
      question('d4', 'Which practice supports accountable innovation?', ['Independent evaluation and clear documentation', 'Undisclosed conflicts of interest', 'Removing all user feedback', 'Hiding system limitations'], 0, 'Independent review and documentation enable scrutiny.'),
      question('d5', 'What does accessibility contribute?', ['More people can participate in and benefit from technology', 'Only a cosmetic feature', 'A reason to ignore users', 'A replacement for consent'], 0, 'Accessibility is a core condition for broad participation.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
  {
    courseId: COURSE_ID,
    lessonId: 'voices',
    order: 5,
    title: 'Futurists, visionaries, and critics',
    summary: 'Meet advocates and critics who frame the human future in different ways.',
    body:
      'Futurists do not agree about what progress means. David Brin connects technological futures with civic accountability. James Hughes argues that democratic societies should prepare for redesigned bodies and minds. Martine Rothblatt links biotechnology, medical ethics, and freedom of form.\n\nCritics are equally important. Donna Haraway questions simple boundaries between human and machine. Joy Buolamwini and Ruha Benjamin show how technical systems can reproduce inequality. Jaron Lanier raises concerns about dignity and concentrated digital power.\n\nEinstein, Bertrand Russell, Carl Sagan, Octavia Butler, and Alan Turing are included as foundational visionaries. Their work informs modern debates, but this course does not inaccurately label them transhumanists.',
    estimatedMinutes: 15,
    questions: [
      question('v1', 'Why are critics included in a futurism course?', ['To examine equity, power, and unintended harms', 'To stop all scientific research', 'To avoid reading evidence', 'To make profiles identical'], 0, 'Critical perspectives help learners test whether innovation serves everyone.'),
      question('v2', 'How does the course categorize Einstein, Russell, and Sagan?', ['As transhumanists', 'As foundational visionaries', 'As Course Administrators', 'As AI systems'], 1, 'They influenced scientific and civic thought but were not transhumanists.'),
      question('v3', 'What does a profile citation help a learner do?', ['Trace an idea to its source and explore context', 'Treat every claim as unquestionable', 'Hide disagreement', 'Replace the lesson'], 0, 'Citations support careful, independent learning.'),
      question('v4', 'Which is a good response to a contested futurist claim?', ['Compare evidence and listen to affected communities', 'Assume the newest claim is true', 'Ignore history', 'Reject all questions'], 0, 'Evidence and lived experience both matter when evaluating high-stakes claims.'),
      question('v5', 'Why label categories on profiles?', ['To make differences in perspective clear', 'To claim everyone agrees', 'To rank people by fame', 'To remove nuance'], 0, 'Clear labels prevent misleading classifications.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
  {
    courseId: COURSE_ID,
    lessonId: 'responsible-futures',
    order: 6,
    title: 'Building responsible futures',
    summary: 'Apply the course principles to real decisions about emerging technology.',
    body:
      'Responsible futurism combines curiosity with humility. It distinguishes evidence from marketing, seeks affected voices, and keeps alternatives open. It treats safety, privacy, accessibility, and justice as design requirements rather than public-relations additions.\n\nWhen evaluating a proposal, ask: What problem is it solving? Who defines success? What evidence supports it? Who may be excluded or harmed? Can people decline it? How will errors be detected and corrected?\n\nThe aim is not to predict one inevitable future. It is to help people participate in shaping futures that protect dignity, agency, and shared flourishing.',
    estimatedMinutes: 10,
    questions: [
      question('r1', 'Which question helps distinguish evidence from hype?', ['What independent evidence supports the claim?', 'Is the slogan memorable?', 'Is the product expensive?', 'Does it have a robot logo?'], 0, 'Independent evidence is more reliable than promotion.'),
      question('r2', 'A responsible deployment plan should include:', ['Ways to monitor, appeal, and correct errors', 'No opportunity for feedback', 'Only a launch date', 'A promise that failure is impossible'], 0, 'Monitoring and recourse are central safeguards.'),
      question('r3', 'Why should affected communities participate?', ['They understand lived needs and possible harms', 'Participation always slows progress', 'Only engineers have relevant knowledge', 'It removes the need for testing'], 0, 'Lived experience often reveals requirements that technical teams miss.'),
      question('r4', 'What does the course mean by agency?', ['A person’s meaningful ability to make and act on choices', 'A company marketing team', 'A prediction about the future', 'A type of hardware'], 0, 'Agency depends on real, supported choices.'),
      question('r5', 'What is the course’s overall aim?', ['Shape humane, evidence-based, and democratic futures', 'Predict one unavoidable future', 'Promote a single company', 'Avoid all ethical questions'], 0, 'The course is about informed participation, not inevitability.'),
    ],
    updatedAt: UPDATED_AT,
    updatedBy: SOURCE,
  },
];

const commons = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`;
const commonsPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file).replace(/%20/g, '_')}`;
const portrait = (file: string, alt: string) => ({
  portraitImage: null,
  portraitUrl: commons(file),
  portraitAlt: alt,
  portraitCredit: 'Wikimedia Commons contributor(s)',
  portraitLicense: 'Open licence or public domain; see linked source file',
  portraitSourceUrl: commonsPage(file),
});

const profile = (
  profileId: string,
  order: number,
  name: string,
  category: FuturistProfile['category'],
  biography: string,
  ideas: readonly string[],
  quote: string,
  quoteSource: string,
  quoteUrl: string,
  furtherReadingUrl: string,
  image: ReturnType<typeof portrait>,
): FuturistProfile => ({
  courseId: COURSE_ID,
  profileId,
  order,
  name,
  category,
  biography,
  ideas,
  quote,
  quoteSource,
  quoteUrl,
  furtherReadingUrl,
  ...image,
  updatedAt: UPDATED_AT,
  updatedBy: SOURCE,
});

export const transhumanismProfiles: readonly FuturistProfile[] = [
  profile('david-brin', 1, 'David Brin', 'democratic_transhumanist', 'Science-fiction author and public intellectual whose work connects transparency, civic responsibility, and technological change.', ['Participatory futures', 'Accountability and transparency', 'Pluralism'], '“We are each other’s watchdogs.”', 'The Transparent Society', 'https://www.davidbrin.com/transparentsociety.html', 'https://www.davidbrin.com/', portrait('David_Brin_at_2013_Texas_Book_Festival.jpg', 'David Brin speaking at a book festival.')),
  profile('james-hughes', 2, 'James Hughes', 'democratic_transhumanist', 'Sociologist and bioethicist known for democratic transhumanism and the civic questions raised by enhancement.', ['Democracy and technology', 'Personhood', 'Public access'], '“Technology and democracy are the principal ways we have of improving the quality of life.”', 'Citizen Cyborg', 'https://cohering.net/re/001cybcit.html', 'https://cohering.net/re/001cybcit.html', portrait('James_Hughes_(sociologist).jpg', 'James Hughes.')),
  profile('martine-rothblatt', 3, 'Martine Rothblatt', 'democratic_transhumanist', 'Technologist, entrepreneur, lawyer, and medical ethicist whose work spans organ replacement, biotechnology, identity, and digital personhood.', ['Medical ethics', 'Freedom of form', 'Biotechnology for health'], '“Life is the ultimate human right.”', 'From Transgender to Transhuman', 'https://www.terasemjournals.org/GN0201/rothblatt.html', 'https://www.unither.com/about-us/leadership/martine-rothblatt', portrait('Martine_Rothblatt.jpg', 'Martine Rothblatt.')),
  profile('natasha-vita-more', 4, 'Natasha Vita-More', 'transhumanist_pioneer', 'Designer, writer, and educator whose work brings longevity, human enhancement, and ethical foresight into transhumanist practice.', ['Ethical enhancement', 'Longevity', 'Foresight and design'], '“We are in the process of upgrading the human species, so we might as well do it with deliberation and foresight.”', 'The Transhumanist Reader, introduction', 'https://www.natashavita-more.com/about', 'https://www.natashavita-more.com/about', portrait('Natasha_Vita-More.jpg', 'Natasha Vita-More.')),
  profile('anders-sandberg', 5, 'Anders Sandberg', 'transhumanist_pioneer', 'Researcher in neuroscience, policy, human enhancement, and long-term risk who connects future possibilities with careful ethical analysis.', ['Neuroethics', 'Human enhancement', 'Long-term risk'], '“The future is not a destination, but a direction.”', 'Public writing and talks on futures studies', 'https://www.anderssandberg.info/', 'https://www.anderssandberg.info/', portrait('Anders_Sandberg.jpg', 'Anders Sandberg.')),
  profile('fm-2030', 6, 'FM-2030', 'transhumanist_pioneer', 'Futurist and writer formerly known as F. M. Esfandiary, remembered for treating identity, longevity, and social change as open questions.', ['Future-oriented identity', 'Longevity', 'Cosmopolitanism'], '“There are no limits to growth because there are no limits of human intelligence.”', 'Are You a Transhuman?', 'https://www.fm2030.com/', 'https://www.fm2030.com/', portrait('FM-2030.jpg', 'FM-2030.')),
  profile('max-more', 7, 'Max More', 'transhumanist_pioneer', 'Philosopher associated with extropianism and early transhumanist principles, focusing on self-direction and continual improvement.', ['Extropianism', 'Self-direction', 'Critical rationality'], '“Transhumanism is a class of philosophies that seek the continuation and acceleration of the evolution of intelligent life.”', 'The Philosophy of Transhumanism', 'https://www.maxmore.com/transhum.htm', 'https://www.maxmore.com/', portrait('Max_More.jpg', 'Max More.')),
  profile('ramez-naam', 8, 'Ramez Naam', 'transhumanist_pioneer', 'Technologist and science-fiction writer whose accessible fiction explores augmentation, privacy, inequality, and political consequences.', ['Augmentation', 'Civil liberties', 'Climate and innovation'], '“The future is better than you think.”', 'More Than Human', 'https://rameznaam.com/books/', 'https://rameznaam.com/', portrait('Ramez_Naam.jpg', 'Ramez Naam.')),
  profile('donna-haraway', 9, 'Donna Haraway', 'ethical_technology_thinker', 'Scholar of science and technology whose cyborg work challenges simple boundaries between human, machine, nature, and culture.', ['Cyborg theory', 'Situated knowledge', 'Power and identity'], '“I’d rather be a cyborg than a goddess.”', 'A Cyborg Manifesto', 'https://web.archive.org/web/20200101000000/https://monoskop.org/images/f/f4/Haraway_Donna_J_A_Cyborg_Manifesto.pdf', 'https://www.donnaharaway.org/', portrait('Donna_Haraway_2006.jpg', 'Donna Haraway.')),
  profile('susan-schneider', 10, 'Susan Schneider', 'ethical_technology_thinker', 'Philosopher who examines AI, consciousness, and the moral status of non-biological minds.', ['AI consciousness', 'Personhood', 'Ethics of mind design'], '“The future of the mind is a philosophical problem as much as a scientific one.”', 'Artificial You', 'https://schneiderwebsite.com/artificial-you/', 'https://schneiderwebsite.com/', portrait('Susan_Schneider.jpg', 'Susan Schneider.')),
  profile('joy-buolamwini', 11, 'Joy Buolamwini', 'ethical_technology_thinker', 'Computer scientist and advocate whose work made algorithmic bias and accountability visible to a broad public.', ['Algorithmic justice', 'Auditing', 'Inclusive design'], '“If you have a face, you have a place in the conversation.”', 'Algorithmic Justice League', 'https://www.ajl.org/', 'https://www.ajl.org/', portrait('Joy_Buolamwini.jpg', 'Joy Buolamwini.')),
  profile('ruha-benjamin', 12, 'Ruha Benjamin', 'ethical_technology_thinker', 'Sociologist who studies how innovation can reproduce inequality and how communities can build more just alternatives.', ['Race and technology', 'Equity', 'Abolitionist design'], '“Technology is a shiny new tool for reinforcing old systems.”', 'Race After Technology', 'https://www.ruhabenjamin.com/race-after-technology', 'https://www.ruhabenjamin.com/', portrait('Ruha_Benjamin.jpg', 'Ruha Benjamin.')),
  profile('jaron-lanier', 13, 'Jaron Lanier', 'ethical_technology_thinker', 'Computer scientist, artist, and writer who argues for human dignity and agency in digital systems.', ['Human dignity', 'Virtual reality', 'Digital power'], '“Information is alienated experience.”', 'Who Owns the Future?', 'https://www.jaronlanier.com/', 'https://www.jaronlanier.com/', portrait('Jaron_Lanier.jpg', 'Jaron Lanier.')),
  profile('albert-einstein', 14, 'Albert Einstein', 'foundational_visionary', 'Physicist whose scientific imagination and civic writing influenced later debates about knowledge, responsibility, and peace. He was not a transhumanist.', ['Scientific curiosity', 'Civic responsibility', 'Peace'], '“The important thing is not to stop questioning.”', 'Life magazine interview, 1955', 'https://einsteinpapers.press.princeton.edu/', 'https://einsteinpapers.press.princeton.edu/', portrait('Albert_Einstein_Head.jpg', 'Albert Einstein.')),
  profile('bertrand-russell', 15, 'Bertrand Russell', 'foundational_visionary', 'Philosopher, logician, and public intellectual who wrote about reason, peace, and the social consequences of scientific power. He was not a transhumanist.', ['Reason', 'Peace', 'Scientific responsibility'], '“The good life is one inspired by love and guided by knowledge.”', 'What I Believe', 'https://russell.arts.mcgill.ca/~bennett/whati.html', 'https://russell.arts.mcgill.ca/', portrait('Bertrand_Russell_1957.jpg', 'Bertrand Russell.')),
  profile('carl-sagan', 16, 'Carl Sagan', 'foundational_visionary', 'Astronomer and science communicator who joined wonder about the cosmos with concern for the fragility of life on Earth. He was not a transhumanist.', ['Scientific literacy', 'Planetary stewardship', 'Cosmic perspective'], '“Somewhere, something incredible is waiting to be known.”', 'Cosmos', 'https://www.carlsagan.com/', 'https://www.carlsagan.com/', portrait('Carl_Sagan_1994.jpg', 'Carl Sagan.')),
  profile('octavia-butler', 17, 'Octavia E. Butler', 'foundational_visionary', 'Science-fiction writer whose novels explore hierarchy, adaptation, gender, race, and change. She was not a transhumanist.', ['Social change', 'Power', 'Adaptation'], '“All that you touch You Change. All that you Change Changes you.”', 'Parable of the Sower', 'https://www.octaviabutler.com/', 'https://www.octaviabutler.com/', portrait('Octavia_Butler_cropped.jpg', 'Octavia E. Butler.')),
  profile('alan-turing', 18, 'Alan Turing', 'foundational_visionary', 'Mathematician and computing pioneer whose work frames modern questions about machines, intelligence, and the future of thought. He was not a transhumanist.', ['Computation', 'Machine intelligence', 'Scientific inquiry'], '“We can only see a short distance ahead, but we can see plenty there that needs to be done.”', 'Computing Machinery and Intelligence', 'https://academic.oup.com/mind/article/LIX/236/433/986238', 'https://www.turing.org.uk/', portrait('Alan_Turing_Aged_16.jpg', 'Alan Turing as a young person.')),
];

