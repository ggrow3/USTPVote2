import type { Provider } from '@nestjs/common';
import { ApiKeys } from '../api-keys/api-keys.js';
import { CONFIG, type ServerConfig } from '../config.js';
import { AreaContactRepository } from './area-contact.repository.js';
import { AreaContactsService } from './area-contacts.service.js';
import { CandidaciesService } from './candidacies.service.js';
import { CandidacyRepository } from './candidacy.repository.js';
import { CONTACT_SOURCE, LocalContactSource, PublicContactSource } from './contact-source.js';
import { CensusDistrictSource, DISTRICT_SOURCE, LocalDistrictSource } from './district-source.js';
import { LocalProfileSource, PROFILE_SOURCE, WikipediaProfileSource } from './profile-source.js';
import { RaceRecordRepository } from './race-record.repository.js';
import { RacesService } from './races.service.js';

/** Everything the candidacies context provides, for the API module to register (design §3.3, §5.8, §5.12, §5.17). */
export const CANDIDACIES_PROVIDERS: Provider[] = [
  CandidacyRepository,
  CandidaciesService,
  AreaContactRepository,
  AreaContactsService,
  RaceRecordRepository,
  RacesService,
  {
    provide: CONTACT_SOURCE,
    inject: [CONFIG, ApiKeys],
    useFactory: (config: ServerConfig, keys: ApiKeys) =>
      config.districtSource === 'local' ? new LocalContactSource() : new PublicContactSource(() => keys.contactKeys()),
  },
  {
    provide: PROFILE_SOURCE,
    inject: [CONFIG],
    useFactory: (config: ServerConfig) => (config.districtSource === 'local' ? new LocalProfileSource() : new WikipediaProfileSource()),
  },
  {
    provide: DISTRICT_SOURCE,
    inject: [CONFIG],
    useFactory: (config: ServerConfig) => (config.districtSource === 'local' ? new LocalDistrictSource() : new CensusDistrictSource()),
  },
];
