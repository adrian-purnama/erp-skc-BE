import cors from "cors";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { connectDatabase } from "./core/database";
import { env } from "./core/env";
import { appConfigService } from "./modules/appConfig/AppConfig.service";
import { logger } from "./core/logger";
import adminRoutes from "./modules/admin/admin.route";
import appConfigRoutes from "./modules/appConfig/AppConfig.route";
import authRoutes from "./modules/auth/auth.route";
import customerRoutes from "./modules/customer/customer.route";
import mediaRoutes from "./modules/media/media.route";
import itemMasterRoutes from "./modules/itemMaster/itemMaster.route";
import notificationRoutes from "./modules/notification/notification.route";
import projectRoutes from "./modules/project/project.route";
import quotationRoutes from "./modules/quotation/quotation.route";
import productionRoutes from "./modules/production/production.route";
import purchasingRoutes from "./modules/purchasing/purchasing.route";
import publicQuotationRoutes from "./modules/quotation/publicQuotation.route";
import termOfPaymentRoutes from "./modules/termOfPayment/termOfPayment.route";
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
    "/notifications",
    notificationRoutes,
    require.resolve("./modules/notification/notification.route"),
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
    "/quotation",
    quotationRoutes,
    require.resolve("./modules/quotation/quotation.route"),
  );
  mountRouter(
    app,
    "/production",
    productionRoutes,
    require.resolve("./modules/production/production.route"),
  );
  mountRouter(
    app,
    "/purchasing",
    purchasingRoutes,
    require.resolve("./modules/purchasing/purchasing.route"),
  );
  mountRouter(
    app,
    "/public/quotation",
    publicQuotationRoutes,
    require.resolve("./modules/quotation/publicQuotation.route"),
  );
  mountRouter(
    app,
    "/uom",
    uomRoutes,
    require.resolve("./modules/uom/uom.route"),
  );
  mountRouter(
    app,
    "/term-of-payment",
    termOfPaymentRoutes,
    require.resolve("./modules/termOfPayment/termOfPayment.route"),
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
