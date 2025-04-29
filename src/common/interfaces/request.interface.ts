import { Request } from 'express';
import { User, UserDoc } from '../../modules/customer/schemas/user.schema';

// export class UserDocument {
//   _id: string;
//   email: string;
//   firstName: string;
//   lastName: string;
//   name: string;
//   firebaseUserId: string;
//   otp: string;
//   otpExpiryDate: string;
//   signUpMethod: string;
//   createdAt: string;
//   updatedAt: string;
//   __v: number;
// }

export interface ExtendedRequest extends Request {
  authenticatedData: UserDoc & Record<string, any>;
}
