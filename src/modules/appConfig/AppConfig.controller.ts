import type { Request, Response } from "express";
import { ApiResponseDto } from "../../dto/apiResponse.dto";
import { appConfigService } from "./AppConfig.service";

export class AppConfigController {
  getBranding = (_req: Request, res: Response) => {
    const { appName, appLogo, openLogin, openRegister } =
      appConfigService.getAppConfig();

    return res.status(200).json({
      success: true,
      message: "Branding retrieved",
      data: {
        appName,
        appLogo,
        openLogin,
        openRegister,
        firstRegister: appConfigService.firstRegister,
      },
    } satisfies ApiResponseDto<{
      appName: string;
      appLogo: string | null;
      openLogin: boolean;
      openRegister: boolean;
      firstRegister: boolean;
    }>);
  };
}
