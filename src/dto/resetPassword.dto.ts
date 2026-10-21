export interface ResetPasswordInDto {
    email: string
    otp: string
    password: string
}

export interface ResetPasswordOutDto {
    email: string
}
