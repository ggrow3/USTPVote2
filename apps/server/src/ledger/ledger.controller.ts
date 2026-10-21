import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { parseQuery } from '../common/validation.js';
import { LedgerService } from './ledger.service.js';

const position = z.coerce.number().int().min(1);

/**
 * The published ledger (design §8, §12): blocks with their signatures, the keys that signed them, public entries with
 * inclusion proofs, and the latest anchor. Anyone may read these; private entries appear only as Merkle leaves.
 */
@Controller('v1/public')
@Public()
export class PublicLedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('ledger/blocks')
  blocks(@Query('after') after?: string, @Query('limit') limit?: string) {
    return this.ledger.blocks(
      parseQuery(z.coerce.number().int().min(0).default(0), after, 'after'),
      parseQuery(z.coerce.number().int().min(1).max(200).default(50), limit, 'limit'),
    );
  }

  @Get('ledger/blocks/:index')
  block(@Param('index') index: string) {
    return this.ledger.block(parseQuery(position, index, 'index'));
  }

  @Get('ledger/entries/:seq')
  entry(@Param('seq') seq: string) {
    return this.ledger.publicEntry(parseQuery(position, seq, 'seq'));
  }

  @Get('ledger/keys')
  keys() {
    return this.ledger.keys();
  }

  @Get('anchors/latest')
  latestAnchor() {
    return this.ledger.latestAnchor();
  }
}
