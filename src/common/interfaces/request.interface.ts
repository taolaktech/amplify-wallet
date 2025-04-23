import { Request } from 'express';

export class UserDocument {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  firebaseUserId: string;
  otp: string;
  otpExpiryDate: string;
  signUpMethod: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface ExtendedRequest extends Request {
  authenticatedData: UserDocument & Record<string, any>;
}
