export interface AdminUserOutDto {
  id: string;
  email: string;
  isBlocked: boolean;
  roles: string[];
}

export interface UpdateAdminUserDto {
  password?: string;
  isBlocked?: boolean;
}

export interface AdminUserDetailOutDto extends AdminUserOutDto {
  accountCreatedAt: string;
}
