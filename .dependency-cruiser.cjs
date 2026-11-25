// Module-boundary guardrail for ADR-0001 (docs/adr/0001-module-boundaries.md).
//
//   npm run check:boundaries            fail on any violation not in the baseline
//   npm run check:boundaries:baseline   drop fixed leaks from the baseline (shrink-only: never adds)
//
// Known violations live in .dependency-cruiser-known-violations.json. They are
// the migration backlog (ADR steps 9-15 and the foreign model reads). The
// baseline should only ever shrink: never re-record it to hide a new leak.
//
// Parser: swc, because TypeScript 7.0 lacks the compiler API dependency-cruiser
// uses. swc still tells `import type` apart ("type-only").
/** @type {import('dependency-cruiser').IConfiguration} */

// Layer order, lowest first (ADR-0001 rule 6). A module may import only from
// its own layer or below; cycles inside a layer are caught by no-circular.
// email / phone / ownerContact sit in platform: notification sends through
// email.service, and the contact sub-documents depend on nothing above them.
const LAYERS = [
  ["auth", "appConfig", "notification", "mail", "otp", "media", "email", "phone", "ownerContact", "landing"],
  ["uom", "itemMaster", "vendor", "customer", "termOfPayment"],
  ["project"],
  ["quotation", "purchasing"],
  ["production"],
  ["admin"],
];

// What each module owns until models/, dto/ and validation/ move into the
// modules (ADR step 19). `models` per TIDINESS_AUDIT.md §0.2; `flat` are the
// stems of its files in dto/ and validation/, which count as module code.
const OWNERS = {
  project: {
    models: [
      "project", "projectCalendarEvent", "projectDocument", "projectLooseFile",
      "projectProductionFile", "projectRab", "projectRabChange", "projectSchedule",
      "projectShopDrawingBoq", "projectShopDrawingDocument", "projectShopDrawingItem",
    ],
    flat: [
      "project", "projectCalendar", "projectDocument", "projectLooseFile", "projectRab",
      "projectRabChange", "projectSchedule", "projectShopDrawing", "projectShopDrawingBoq",
    ],
  },
  purchasing: {
    models: [
      "purchaseOrder", "purchaseOrderQuotation", "purchasePayment", "purchaseRab",
      "purchaseRealization", "purchaseRequest", "vendorInvoice",
    ],
    flat: ["purchasing"],
  },
  production: {
    models: ["productionOrder", "productionReport", "productionHandover", "materialDispatch"],
    flat: ["production"],
  },
  quotation: { models: ["projectQuotation"], flat: ["projectQuotation"] },
  itemMaster: { models: ["item", "itemCategory", "itemTarif", "itemUom", "folder"], flat: ["itemMaster"] },
  uom: { models: ["uom"], flat: ["uom"] },
  vendor: { models: ["vendor"], flat: ["vendor"] },
  customer: { models: ["customer"], flat: ["customer"] },
  termOfPayment: { models: ["termOfPayment"], flat: ["termOfPayment"] },
  appConfig: { models: ["appconfig"], flat: [] },
  landing: { models: ["landingCategory", "landingPost"], flat: ["landing"] },
  notification: { models: ["notification"], flat: ["notification"] },
  // Contact sub-document schemas, embedded by customer and vendor.
  email: { models: ["email"], flat: [], sharedWith: ["customer", "vendor"] },
  phone: { models: ["phone"], flat: [], sharedWith: ["customer", "vendor"] },
  otp: { models: ["otp"], flat: ["sendOtp"] },
  auth: { models: [], flat: ["auth", "login", "register", "profile", "resetPassword"] },
  admin: { models: ["shrinkRun"], flat: ["adminUser", "audit", "dashboardMetrics", "role", "shrinkDb"] },
};

// Identity and access are platform (ADR-0001 rule 9).
const IDENTITY_MODELS = ["user", "role", "permission"];
const IDENTITY_READERS = ["auth", "admin"];

// Not subject to boundary rules: the composition root, scripts, the global
// Express types and the flat model folder (schemas reference each other).
const COMPOSITION = ["^src/index\\.ts$", "^src/scripts/", "^src/types\\.d\\.ts$", "^src/models/"];

const alt = (xs) => `(${xs.join("|")})`;
const flatPath = (stems) => `^src/(dto|validation)/${alt(stems)}(\\.dto)?\\.ts$`;
/** Paths that count as `owner`'s own code. */
const ownCode = (owner) => {
  const paths = [`^src/modules/${owner}/`];
  const flat = OWNERS[owner]?.flat ?? [];
  if (flat.length) paths.push(flatPath(flat));
  return paths;
};
const ALL_FLAT = Object.values(OWNERS).flatMap((o) => o.flat);
const PUBLIC_ENTRY = ["^src/modules/[^/]+/index\\.ts$", "^src/modules/[^/]+/[^/]+\\.ports\\.ts$"];

const layeringRules = LAYERS.slice(0, -1).map((layer, i) => ({
  name: `layering-${i}`,
  comment: `${layer.join(", ")} may not import higher layers (ADR-0001 rule 6). Declare a port instead.`,
  severity: "error",
  from: { path: [`^src/modules/${alt(layer)}/`, ...layer.flatMap((m) => ownCode(m).slice(1))] },
  to: { path: `^src/modules/${alt(LAYERS.slice(i + 1).flat())}/` },
}));

const modelRules = Object.entries(OWNERS)
  .filter(([, o]) => o.models.length)
  .map(([owner, o]) => ({
    name: `models-of-${owner}`,
    comment: `Only ${owner} may import these models (ADR-0001 rule 3). Call its public function instead.`,
    severity: "error",
    from: {
      path: "^src/",
      pathNot: [...ownCode(owner), ...(o.sharedWith ?? []).flatMap(ownCode), ...COMPOSITION],
    },
    to: { path: `^src/models/${alt(o.models)}\\.model\\.ts$`, dependencyTypesNot: ["type-only"] },
  }));

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "No import cycles (ADR-0001 rule 5).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "module-only-via-index",
      comment:
        "Import another module only through its index.ts (ADR-0001 rule 1). " +
        "A higher module may import a lower module's *.ports.ts to implement it.",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/([^/]+)/", pathNot: ["^src/modules/$1/", ...PUBLIC_ENTRY] },
    },
    // dto/ and validation/ files act as part of their owning module (until step 19).
    ...Object.keys(OWNERS)
      .filter((owner) => OWNERS[owner].flat.length)
      .map((owner) => ({
        name: `flat-${owner}-only-via-index`,
        comment: `${owner}'s dto/validation files import other modules only through index.ts (ADR-0001 rule 1).`,
        severity: "error",
        from: { path: flatPath(OWNERS[owner].flat) },
        to: { path: "^src/modules/", pathNot: [`^src/modules/${owner}/`, ...PUBLIC_ENTRY] },
      })),
    {
      name: "shared-not-into-modules",
      comment: "Shared code (core/, utils/, middleware/, shared dto/validation) must not import modules (ADR-0001 rule 4).",
      severity: "error",
      from: {
        path: "^src/(core|utils|middleware|dto|validation|models)/",
        pathNot: [flatPath(ALL_FLAT), "^src/core/permissions/registry\\.ts$"],
      },
      to: { path: "^src/modules/" },
    },
    {
      name: "registry-only-permission-defs",
      comment: "core/permissions/registry.ts collects each module's *.permissions.ts and nothing else.",
      severity: "error",
      from: { path: "^src/core/permissions/registry\\.ts$" },
      to: { path: "^src/modules/", pathNot: "\\.permissions\\.ts$" },
    },
    ...layeringRules,
    ...modelRules,
    {
      name: "models-identity",
      comment: "User / Role / Permission are read only by auth, admin, core/permissions and middleware (ADR-0001 rule 9).",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: [...IDENTITY_READERS.flatMap(ownCode), "^src/core/permissions/", "^src/middleware/", ...COMPOSITION],
      },
      to: { path: `^src/models/${alt(IDENTITY_MODELS)}\\.model\\.ts$`, dependencyTypesNot: ["type-only"] },
    },
    ...modelRules.map((rule) => ({
      ...rule,
      name: `${rule.name}-type-only`,
      comment: "Type-only import of another module's model: allowed, but prefer the owner's DTO type.",
      severity: "info",
      to: { path: rule.to.path, dependencyTypes: ["type-only"] },
    })),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.test\\.ts$" },
    tsConfig: { fileName: "tsconfig.json" },
    parser: "swc",
    tsPreCompilationDeps: true,
  },
};

if (LAYERS.flat().some((m, i, all) => all.indexOf(m) !== i)) {
  throw new Error(".dependency-cruiser.cjs: a module is listed in two layers");
}
