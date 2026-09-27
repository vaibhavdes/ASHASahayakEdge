import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { createSampleFamily } from "../lib/households";
import { useSettings } from "../lib/hooks";
import { tr } from "../lib/i18n";
import { useNav } from "../lib/nav";
import { Button, Card } from "./ui";

/** Shown while the phone has no families: add a real one, or a fictional sample to try the app. */
export function StartCard() {
  const nav = useNav();
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  return (
    <Card className="space-y-3">
      <p className="text-sm text-slate-700">
        {tr("अभी कोई परिवार नहीं है। परिवार जोड़ें, फिर उसकी विज़िट दर्ज करें।", "No families yet. Add a family, then record a visit for them.")}
      </p>
      <Button className="w-full" onClick={() => nav.push({ screen: "addFamily" })}>
        <Plus size={18} /> {tr("नया परिवार", "Add family")}
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { household } = await createSampleFamily(settings.village, settings.deviceId);
          nav.push({ screen: "household", id: household.id });
        }}
      >
        <Sparkles size={18} /> {tr("नमूना परिवार से आज़माएं", "Try with a sample family")}
      </Button>
      <p className="text-xs text-slate-500">
        {tr("नमूना परिवार काल्पनिक है: गर्भवती मां, 3 साल का बच्चा और पिता।", "The sample family is fictional: a pregnant mother, a 3-year-old child and the father.")}
      </p>
    </Card>
  );
}
