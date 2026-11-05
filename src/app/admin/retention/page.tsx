import { RETENTION_RULES } from "@/lib/retention/policy";
import RetentionDashboard from "./RetentionDashboard";

export const metadata = {
  title: "Data Retention — Admin",
};

export default function RetentionPage() {
  const rules = RETENTION_RULES.map((rule) => ({
    target: rule.target,
    envVar: rule.envVar,
    defaultDays: rule.defaultDays,
    configuredDays: (() => {
      const raw = process.env[rule.envVar];
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isInteger(n) && n > 0 ? n : rule.defaultDays;
    })(),
    rationale: rule.rationale,
  }));

  const retentionEnabled = !!process.env.DATA_RETENTION_DAYS;

  return <RetentionDashboard rules={rules} retentionEnabled={retentionEnabled} />;
}

