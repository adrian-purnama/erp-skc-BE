import { get } from "../../../core/permissions/registry";
import {
  PermissionModel,
  type PermissionStatus,
} from "../../../core/permissions/permission.model";
import { getLastScan } from "../../../core/permissions/scan";
import { planScanViolations } from "../../../core/permissions/sync";

export type PermissionOut = {
  key: string;
  label: string;
  category: string;
  status: PermissionStatus;
  manual: boolean;
  routes: Array<{ method: string; path: string }>;
  implies: string[];
};

export class PermissionService {
  async list(query: {
    q?: string;
    status?: string;
  }): Promise<Record<string, PermissionOut[]>> {
    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }

    let docs = await PermissionModel.find(filter).sort({ key: 1 }).exec();

    if (query.q?.trim()) {
      const q = query.q.trim().toLowerCase();
      docs = docs.filter((doc) => {
        if (doc.key.toLowerCase().includes(q)) return true;
        if (doc.label.toLowerCase().includes(q)) return true;
        if (doc.category.toLowerCase().includes(q)) return true;
        return doc.routes.some((r) => r.path.toLowerCase().includes(q));
      });
    }

    const grouped: Record<string, PermissionOut[]> = {};
    for (const doc of docs) {
      const def = get(doc.key);
      const item: PermissionOut = {
        key: doc.key,
        label: doc.label,
        category: doc.category,
        status: doc.status,
        manual: doc.manual,
        routes: doc.routes.map((r) => ({ method: r.method, path: r.path })),
        implies: def?.implies ? [...def.implies] : [],
      };
      if (!grouped[doc.category]) grouped[doc.category] = [];
      grouped[doc.category]!.push(item);
    }
    return grouped;
  }

  async scanReportWithCounts() {
    const scan = getLastScan();
    const violations = scan ? planScanViolations(scan) : [];
    const [active, unused, deprecated] = await Promise.all([
      PermissionModel.countDocuments({ status: "active" }).exec(),
      PermissionModel.countDocuments({ status: "unused" }).exec(),
      PermissionModel.countDocuments({ status: "deprecated" }).exec(),
    ]);
    return {
      scan,
      violations,
      authOnly: scan?.authOnly ?? [],
      counts: {
        active,
        unused,
        deprecated,
        unprotected:
          scan?.routes.filter((r) => r.authType === "none").length ?? 0,
        authOnly: scan?.authOnly.length ?? 0,
      },
    };
  }
}

export const permissionService = new PermissionService();
