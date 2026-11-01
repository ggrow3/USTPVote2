import type { Provider } from '@nestjs/common';
import { CONFIG, type ServerConfig } from '../config.js';
import { AreaContactRepository } from './area-contact.repository.js';
import { AreaContactsService } from './area-contacts.service.js';
import { CandidaciesService } from './candidacies.service.js';
import { CandidacyRepository } from './candidacy.repository.js';
import { CONTACT_SOURCE, LocalContactSource, PublicContactSource } from './contact-source.js';
import { CensusDistrictSource, DISTRICT_SOURCE, LocalDistrictSource } from './district-source.js';

/** Everything the candidacies context provides, for the API module to register (design §3.3, §5.8). */
export const CANDIDACIES_PROVIDERS: Provider[] = [
  CandidacyRepository,
  CandidaciesService,
  AreaContactRepository,
  AreaContactsService,
  {
    provide: CONTACT_SOURCE,
    inject: [CONFIG],
    useFactory: (config: ServerConfig) =>
      config.districtSource === 'local' ? new LocalContactSource() : new PublicContactSource({ fec: config.fecApiKey, openStates: config.openStatesApiKey }),
  },
  {
    provide: DISTRICT_SOURCE,
    inject: [CONFIG],
    useFactory: (config: ServerConfig) => (config.districtSource === 'local' ? new LocalDistrictSource() : new CensusDistrictSource()),
  },
];
