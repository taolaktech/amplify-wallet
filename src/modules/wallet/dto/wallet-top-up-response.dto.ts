import { ApiProperty } from '@nestjs/swagger';
import { ApiResult } from 'src/common/interfaces/response.interface';
import {
  Transaction,
  TransactionDocument,
} from 'src/database/schema/transaction.schema'; // Corrected path and import

export class WalletTopUpResponseDto extends ApiResult<TransactionDocument> {
  @ApiProperty({
    description: 'The completed transaction document.',
    type: () => Transaction, // Reference the Transaction schema class
  })
  data: TransactionDocument;
}
