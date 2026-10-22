import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { PublicElectionsService } from './public-elections.service.js';

/** The published election record (design §12): anyone may read it, so voters and outsiders can verify. */
@Controller('v1/public/elections')
@Public()
export class PublicElectionsController {
  constructor(private readonly elections: PublicElectionsService) {}

  @Get(':id')
  record(@Param('id') id: string) {
    return this.elections.record(id);
  }

  @Get(':id/sealed-blocks')
  sealedBlocks(@Param('id') id: string) {
    return this.elections.sealedBlocks(id);
  }

  @Get(':id/results')
  results(@Param('id') id: string) {
    return this.elections.results(id);
  }

  @Get(':id/proofs/:commitment')
  proof(@Param('id') id: string, @Param('commitment') commitment: string) {
    return this.elections.proof(id, commitment);
  }
}
