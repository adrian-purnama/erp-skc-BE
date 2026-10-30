import type { Request, Response } from "express";
import { ApiResponseDto } from "../../dto/httpResponse";
import { appConfigService } from "./AppConfig.service";

export class AppConfigController {
  getBranding = (_req: Request, res: Response) => {
    const { appName, description, appLogo, openLogin, openRegister } =
      appConfigService.getAppConfig();

    return res.status(200).json({
      success: true,
      message: "Branding retrieved",
      data: {
        appName,
        description,
        appLogo,
        openLogin,
        openRegister,
        firstRegister: appConfigService.firstRegister,
      },
    } satisfies ApiResponseDto<{
      appName: string;
      description: string;
      appLogo: string | null;
      openLogin: boolean;
      openRegister: boolean;
      firstRegister: boolean;
    }>);
  };
}
