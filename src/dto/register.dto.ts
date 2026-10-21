export interface registerInDto {
    email:string;
    otp:string;
    password:string;
}

export interface RegisterOutDto{
    email:string
    jwt:string
}