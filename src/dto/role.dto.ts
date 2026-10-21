export type CreateRoleInput = {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  includes: string[];
};

export type UpdateRoleInput = {
  name?: string;
  description?: string;
  permissions?: string[];
  includes?: string[];
};
