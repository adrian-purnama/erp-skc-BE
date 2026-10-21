export interface ApiResponseDto<T = null> {
    success: boolean;
    message: string;
    data: T;
  }