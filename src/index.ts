import cors from "cors";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { connectDatabase } from "./database/database";
import { env } from "./environment/env";
import { appConfigService } from "./modules/appConfig/AppConfig.service";
import { logger } from "./logger/logger";
import adminRoutes from "./modules/admin/admin.route";
import appConfigRoutes from "./modules/appConfig/AppConfig.route";
import authRoutes from "./modules/auth/auth.route";
import customerRoutes from "./modules/customer/customer.route";
import mediaRoutes from "./modules/media/media.route";
import itemMasterRoutes from "./modules/itemMaster/itemMaster.route";
import projectRoutes from "./modules/project/project.route";
import uomRoutes from "./modules/uom/uom.route";
import vendorRoutes from "./modules/vendor/vendor.route";
import { seedUoms } from "./modules/uom/uom.seed";
import { shrinkDbService } from "./modules/admin/shrinkDb/shrinkDb.service";
import {
  assertReplicaSet,
  initAuditCollections,
} from "./core/audit/auditedModel";
import { mountRouter } from "./core/permissions/routing";
import { scanRoutes } from "./core/permissions/scan";
import { seedRoles, syncPermissions, validateScan } from "./core/permissions/sync";
// Audited models register via mounted route → service imports before initAuditCollections.

function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(
    cors({
      origin: env.frontendUrl,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      message: "Server is healthy",
      data: { build: env.build },
    });
  });

  mountRouter(
    app,
    "/auth",
    authRoutes,
    require.resolve("./modules/auth/auth.route"),
  );
  mountRouter(
    app,
    "/admin",
    adminRoutes,
    require.resolve("./modules/admin/admin.route"),
  );
  mountRouter(
    app,
    "/app-config",
    appConfigRoutes,
    require.resolve("./modules/appConfig/AppConfig.route"),
  );
  mountRouter(
    app,
    "/media",
    mediaRoutes,
    require.resolve("./modules/media/media.route"),
  );
  mountRouter(
    app,
    "/customer",
    customerRoutes,
    require.resolve("./modules/customer/customer.route"),
  );
  mountRouter(
    app,
    "/vendor",
    vendorRoutes,
    require.resolve("./modules/vendor/vendor.route"),
  );
  mountRouter(
    app,
    "/project",
    projectRoutes,
    require.resolve("./modules/project/project.route"),
  );
  mountRouter(
    app,
    "/uom",
    uomRoutes,
    require.resolve("./modules/uom/uom.route"),
  );
  mountRouter(
    app,
    "/",
    itemMasterRoutes,
    require.resolve("./modules/itemMaster/itemMaster.route"),
  );

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: "Route not found",
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(
      err instanceof Error ? err.message : "Unhandled server error",
      "index",
      "createApp",
    );

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  });

  return app;
}

async function bootstrap() {
  await connectDatabase(env.mongodbUrl, env.build);
  await assertReplicaSet();
  await initAuditCollections();
  await shrinkDbService.recoverOnStartup();

  const app = createApp();
  const scan = scanRoutes(app);
  validateScan(scan, env.rbacScanStrict);
  await syncPermissions(scan);
  await seedRoles();
  await appConfigService.init();
  await seedUoms();

  app.listen(env.port, () => {
    logger.info(
      `Server running at http://localhost:${env.port} (${env.build})`,
      "index",
      "bootstrap",
    );
  });
}

bootstrap().catch((err) => {
  logger.error(
    err instanceof Error ? err.message : String(err),
    "index",
    "bootstrap",
  );
  process.exit(1);
});
