export interface ProfileOutDto {
  email: string;
  fullName: string;
  /** Absolute-path media URL (`/media/<id>`) or null. */
  profilePicture: string | null;
}

export interface UpdateProfileInDto {
  fullName: string;
}

export interface UploadProfilePictureInDto {
  buffer: Buffer;
  filename: string;
  contentType: string;
  size: number;
}

export interface UploadProfilePictureOutDto {
  id: string;
  url: string;
}
