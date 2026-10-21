export interface LoginInDto {
    email: string;
    password: string;
    rememberMe?: boolean;
}

export interface LoginOutDto {
    email: string;
    jwt: string;
}
