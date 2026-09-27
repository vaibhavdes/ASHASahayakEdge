"""Synthetic data for Sahayak Edge.

Everything here is fictional. Produces:
  data/out/villages.json         village list with coordinates
  data/out/demo_households.json  households + members for the two demo devices
  data/out/demo_visits.json      visit notes (Hindi / Hinglish / English) with ground-truth labels
  data/out/history_signals.json  8 weeks of anonymous signals for the cloud baseline
  data/out/eval_queries.json     search benchmark queries with relevance rules

Run:  python data/generate.py
"""

import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(42)
OUT = Path(__file__).parent / "out"
NOW = datetime(2026, 9, 27, 9, 0, tzinfo=timezone.utc)

VILLAGES = [
    {"code": "RMP", "name": "Rampur", "lat": 26.912, "lon": 80.942},
    {"code": "LKP", "name": "Lakhanpur", "lat": 26.935, "lon": 80.975},
    {"code": "SNP", "name": "Sonpur", "lat": 26.884, "lon": 80.991},
    {"code": "DVG", "name": "Devgaon", "lat": 26.861, "lon": 80.921},
    {"code": "KHD", "name": "Kheda", "lat": 26.958, "lon": 80.903},
    {"code": "BRL", "name": "Barauli", "lat": 26.829, "lon": 81.034},
]

FEMALE = ["Sita Devi", "Geeta", "Sunita", "Rekha", "Pooja", "Anita", "Kiran", "Meena", "Radha", "Savitri", "Neha", "Priya"]
MALE = ["Ramesh", "Suresh", "Mahesh", "Rajesh", "Mukesh", "Dinesh", "Arjun", "Ravi", "Mohan", "Vikas", "Aman", "Rohit"]
SURNAMES = ["Yadav", "Verma", "Kumar", "Singh", "Maurya", "Pal", "Gupta", "Rawat"]

# Visit note templates per scenario. Each carries ground-truth syndromes so the
# benchmark can judge relevance without hand labelling.
SCENARIOS = {
    "fever": {
        "syndromes": ["fever"], "ages": ["0-5", "6-14", "15-49", "50+"],
        "notes": [
            "{n} ko 3 din se tez bukhar hai, badan dard",
            "{n} को बुखार है, दो दिन से, पेरासिटामोल दी",
            "High fever since yesterday in {n}, gave paracetamol, advised fluids",
            "{n} ko bukhar aur thand lag rahi hai raat se",
        ],
    },
    "fever_rash": {
        "syndromes": ["fever", "rash"], "ages": ["0-5", "6-14"],
        "notes": [
            "{n} ko bukhar ke saath poore sharir par laal daane",
            "{n} को बुखार और शरीर पर दाने, आँखें लाल",
            "Fever with red rash spreading from face to body in {n}, eyes watery",
            "{n} ke chehre par daane, bukhar 2 din se, khansi bhi",
        ],
    },
    "diarrhoea": {
        "syndromes": ["diarrhoea"], "ages": ["0-5", "6-14", "15-49"],
        "notes": [
            "{n} ko subah se 5 baar dast, ORS diya",
            "{n} को दस्त और उल्टी, ORS और जिंक दिया",
            "Loose motions 4 times since morning in {n}, started ORS and zinc",
            "{n} ko patle dast, pet dard, paani kam pi raha",
        ],
    },
    "cough": {
        "syndromes": ["cough_2w"], "ages": ["15-49", "50+"],
        "notes": [
            "{n} ko 3 hafte se khansi, raat ko pasina, vajan kam",
            "{n} को दो हफ्ते से ज्यादा खांसी, बलगम में खून",
            "Cough for more than two weeks in {n}, weight loss, referred for sputum test",
        ],
    },
    "jaundice": {
        "syndromes": ["jaundice"], "ages": ["6-14", "15-49"],
        "notes": [
            "{n} ki aankhein peeli, peshab peela, bhookh nahi",
            "{n} की आँखें पीली, कमजोरी, पीलिया का शक",
            "Yellow eyes and dark urine in {n}, suspected jaundice",
        ],
    },
    "anc_normal": {
        "syndromes": [], "ages": ["15-49"], "pregnant": True,
        "notes": [
            "{n} ANC visit, 6 mahina, BP 110/70, IFA goli de di",
            "{n} गर्भवती, 7वां महीना, वजन ठीक, टीटी लगा",
            "Routine ANC check for {n}, 5th month, BP normal, IFA given",
        ],
    },
    "anc_danger": {
        "syndromes": ["danger_pregnancy"], "ages": ["15-49"], "pregnant": True, "danger": True,
        "notes": [
            "{n} garbhvati, BP 160/110, sar dard aur dhundhla dikh raha, pair mein sujan",
            "{n} गर्भवती, खून बह रहा है, पेट में तेज दर्द",
            "Pregnant {n}, 8th month, severe headache, blurred vision, swelling of feet, BP 150/100",
        ],
    },
    "newborn_danger": {
        "syndromes": ["danger_newborn"], "ages": ["0-5"], "danger": True, "newborn": True,
        "notes": [
            "{n} ka navjat doodh nahi pee raha, sharir thanda, sust",
            "{n} का नवजात शिशु, झटके आ रहे हैं, दूध नहीं पी रहा",
            "Newborn of {n} not feeding since morning, fast breathing, chest indrawing",
        ],
    },
    "immunization": {
        "syndromes": [], "ages": ["0-5"],
        "notes": [
            "{n} ka teekakaran, Penta-2 aur OPV diya, agla 4 hafte baad",
            "{n} को खसरा का टीका लगाया, विटामिन A दिया",
            "Immunization for {n}: MR-1 and Vitamin A given, next due in 6 months",
        ],
    },
}


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_week(dt):
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def make_households(village, count):
    households = []
    for i in range(count):
        surname = random.choice(SURNAMES)
        head = f"{random.choice(MALE)} {surname}"
        members = [
            {"id": str(uuid.uuid4()), "name": head, "sex": "M", "age": random.randint(28, 60)},
            {"id": str(uuid.uuid4()), "name": f"{random.choice(FEMALE)} {surname}", "sex": "F", "age": random.randint(20, 38)},
        ]
        for _ in range(random.randint(0, 3)):
            sex = random.choice("MF")
            members.append({
                "id": str(uuid.uuid4()),
                "name": f"{random.choice(MALE if sex == 'M' else FEMALE)} {surname}",
                "sex": sex,
                "age": random.randint(0, 14),
            })
        households.append({
            "id": str(uuid.uuid4()),
            "village": village["code"],
            "ward": str(random.randint(1, 5)),
            "house_no": f"{village['code']}-{100 + i}",
            "head": head,
            "phone": f"9{random.randint(100000000, 999999999)}",
            "lat": round(village["lat"] + random.uniform(-0.006, 0.006), 5),
            "lon": round(village["lon"] + random.uniform(-0.006, 0.006), 5),
            "members": members,
            "pregnant_member": members[1]["id"] if random.random() < 0.25 else None,
        })
    return households


def age_band(age):
    if age <= 5:
        return "0-5"
    if age <= 14:
        return "6-14"
    if age <= 49:
        return "15-49"
    return "50+"


def pick_member(household, scenario):
    s = SCENARIOS[scenario]
    if s.get("pregnant"):
        return household["members"][1]
    candidates = [m for m in household["members"] if age_band(m["age"]) in s["ages"]]
    return random.choice(candidates) if candidates else None


def make_visits(households, days, per_day, outbreak=None):
    visits = []
    weights = {"fever": 5, "fever_rash": 1, "diarrhoea": 4, "cough": 1, "jaundice": 1,
               "anc_normal": 4, "anc_danger": 1, "newborn_danger": 1, "immunization": 4}
    for d in range(days):
        day = NOW - timedelta(days=d)
        n = per_day + (outbreak["extra"] if outbreak and d < outbreak["days"] else 0)
        for k in range(n):
            if outbreak and d < outbreak["days"] and k < outbreak["extra"]:
                scenario = outbreak["scenario"]
            else:
                scenario = random.choices(list(weights), weights=list(weights.values()))[0]
            for _ in range(10):
                hh = random.choice(households)
                member = pick_member(hh, scenario)
                if member:
                    break
            if not member:
                continue
            s = SCENARIOS[scenario]
            display = member["name"].split()[0]
            text = random.choice(s["notes"]).format(n=display)
            at = day.replace(hour=random.randint(8, 17), minute=random.randint(0, 59))
            visits.append({
                "id": str(uuid.uuid4()),
                "household_id": hh["id"],
                "member_id": member["id"],
                "member_name": member["name"],
                "village": hh["village"],
                "ward": hh["ward"],
                "sex": member["sex"],
                "age_band": "0-5" if s.get("newborn") else age_band(member["age"]),
                "pregnant": bool(s.get("pregnant")),
                "visit_at": iso(at),
                "text": text,
                "truth": {"scenario": scenario, "syndromes": s["syndromes"], "danger": bool(s.get("danger"))},
            })
    return visits


def make_history():
    """Anonymous weekly signals for 8 past weeks + current week, all villages."""
    signals = []
    base = {"fever": 6, "diarrhoea": 4, "fever_rash": 0.4, "cough_2w": 0.6, "jaundice": 0.3}
    for v in VILLAGES:
        for w in range(8, 0, -1):
            week_day = NOW - timedelta(weeks=w)
            for syn, mean in base.items():
                count = max(0, int(random.gauss(mean, mean ** 0.5 * 0.6)))
                for _ in range(count):
                    signals.append({
                        "id": str(uuid.uuid4()),
                        "village": v["code"],
                        "week": iso_week(week_day),
                        "at": iso(week_day - timedelta(days=random.randint(0, 6))),
                        "syndromes": syn.split("_") if syn == "fever_rash" else [syn],
                        "age_band": random.choice(["0-5", "6-14", "15-49", "50+"]),
                        "danger": False,
                        "source": "history",
                    })
    return signals


EVAL_QUERIES = [
    # q: query text, rel: which ground-truth visits count as relevant
    {"q": "bacche ko dast", "rel": {"syndromes_any": ["diarrhoea"], "age_band": ["0-5", "6-14"]}},
    {"q": "loose motion ORS", "rel": {"syndromes_any": ["diarrhoea"]}},
    {"q": "दस्त उल्टी", "rel": {"syndromes_any": ["diarrhoea"]}},
    {"q": "bukhar aur daane", "rel": {"syndromes_all": ["fever", "rash"]}},
    {"q": "fever with rash", "rel": {"syndromes_all": ["fever", "rash"]}},
    {"q": "बुखार दाने", "rel": {"syndromes_all": ["fever", "rash"]}},
    {"q": "measles jaisa", "rel": {"syndromes_all": ["fever", "rash"]}},
    {"q": "high fever paracetamol", "rel": {"syndromes_any": ["fever"]}},
    {"q": "tez bukhar", "rel": {"syndromes_any": ["fever"]}},
    {"q": "long cough TB suspect", "rel": {"syndromes_any": ["cough_2w"]}},
    {"q": "khansi 3 hafte", "rel": {"syndromes_any": ["cough_2w"]}},
    {"q": "yellow eyes", "rel": {"syndromes_any": ["jaundice"]}},
    {"q": "peeliya", "rel": {"syndromes_any": ["jaundice"]}},
    {"q": "pregnant high BP headache", "rel": {"scenario": ["anc_danger"]}},
    {"q": "garbhvati khoon beh raha", "rel": {"scenario": ["anc_danger"]}},
    {"q": "pregnancy danger signs", "rel": {"scenario": ["anc_danger"]}},
    {"q": "newborn not feeding", "rel": {"scenario": ["newborn_danger"]}},
    {"q": "navjat jhatke", "rel": {"scenario": ["newborn_danger"]}},
    {"q": "baby fast breathing", "rel": {"scenario": ["newborn_danger"]}},
    {"q": "ANC checkup IFA", "rel": {"scenario": ["anc_normal"]}},
    {"q": "garbhvati mahila routine", "rel": {"scenario": ["anc_normal", "anc_danger"]}},
    {"q": "teekakaran", "rel": {"scenario": ["immunization"]}},
    {"q": "MR vaccine vitamin A", "rel": {"scenario": ["immunization"]}},
    {"q": "Penta OPV", "rel": {"scenario": ["immunization"]}},
    # Paraphrases that share no words with the notes or the lexicon.
    {"q": "child passing watery stool again and again", "rel": {"syndromes_any": ["diarrhoea"]}},
    {"q": "spots on skin along with high temperature", "rel": {"syndromes_all": ["fever", "rash"]}},
    {"q": "expecting mother with severe head pain and puffy legs", "rel": {"scenario": ["anc_danger"]}},
    {"q": "infant refusing milk and body cold", "rel": {"scenario": ["newborn_danger"]}},
    {"q": "person coughing for a month and losing weight", "rel": {"syndromes_any": ["cough_2w"]}},
    {"q": "whites of eyes turned yellow", "rel": {"syndromes_any": ["jaundice"]}},
    {"q": "shots given to the baby today", "rel": {"scenario": ["immunization"]}},
    {"q": "मां बनने वाली महिला की जांच", "rel": {"scenario": ["anc_normal", "anc_danger"]}},
]


def main():
    OUT.mkdir(exist_ok=True)
    a, b = VILLAGES[0], VILLAGES[1]
    hh_a = make_households(a, 40)
    hh_b = make_households(b, 30)
    # Device A (Rampur) carries a planted fever+rash cluster in the last 5 days.
    visits_a = make_visits(hh_a, days=45, per_day=4, outbreak={"scenario": "fever_rash", "days": 5, "extra": 1})
    visits_b = make_visits(hh_b, days=45, per_day=3)

    (OUT / "villages.json").write_text(json.dumps(VILLAGES, indent=1, ensure_ascii=False))
    (OUT / "demo_households.json").write_text(json.dumps({"RMP": hh_a, "LKP": hh_b}, indent=1, ensure_ascii=False))
    (OUT / "demo_visits.json").write_text(json.dumps({"RMP": visits_a, "LKP": visits_b}, indent=1, ensure_ascii=False))
    (OUT / "history_signals.json").write_text(json.dumps(make_history(), indent=1))
    (OUT / "eval_queries.json").write_text(json.dumps(EVAL_QUERIES, indent=1, ensure_ascii=False))
    print(f"households: {len(hh_a)}+{len(hh_b)}  visits: {len(visits_a)}+{len(visits_b)}")


if __name__ == "__main__":
    main()
