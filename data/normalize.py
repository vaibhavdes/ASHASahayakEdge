"""Python twin of app/src/lib/normalize.ts (keep the two in sync). Used by eval/ and cloud/."""

import json
import re

# Letters, digits and Devanagari (incl. vowel signs) count as part of a word.
BOUNDARY_BEFORE = r"(?<![\w\u0900-\u097F])"
BOUNDARY_AFTER = r"(?![\w\u0900-\u097F])"

# Negation: "no fever", "without rash", "bukhar nahi hai", "बुखार नहीं है".
NEGATED_BEFORE = re.compile(r"(?:^|[^\w\u0900-\u097F])(no|not|without|koi)\s+$")
NEGATED_AFTER = re.compile(r"^\s+(nahi|nahin|nai|na|नहीं|नही|ना)(?![\w\u0900-\u097F])")

NUKTA = "\u093c"  # "बुख़ार" and "बुखार" are the same word
LATIN_WORD = re.compile(r"(?<![\w\u0900-\u097F])[a-z]{4,}(?![\w\u0900-\u097F])")


def sound_key(word):
    """Spelling-insensitive key for Hinglish: bukhar, bukhaar, bukar and bhukaar all become "bukar"."""
    w = word.replace("ee", "i").replace("oo", "u").replace("z", "j")
    w = re.sub(r"([bcdgjkpt])h", r"\1", w)
    w = w.replace("sh", "s").replace("w", "v").replace("q", "k").replace("y", "i")
    w = re.sub(r"n(?=[sgkjdt])", "", w)
    return re.sub(r"(.)\1+", r"\1", w)


class Normalizer:
    def __init__(self, terms, question_frame=None):
        frame = question_frame or {}
        self.frame_phrases = sorted((x.lower() for x in frame.get("phrases", [])), key=len, reverse=True)
        self.frame_words = {x.lower() for x in frame.get("words", [])}
        # Longest variants first so "patle dast" wins over "dast".
        self.variants = sorted(
            ((variant.lower().replace(NUKTA, ""), canonical) for canonical, variants in terms.items() for variant in variants),
            key=lambda x: -len(x[0]),
        )
        # Sound keys of single Latin words; a key shared by two terms is ambiguous and dropped.
        keys = {}
        for canonical, variants in terms.items():
            for variant in variants:
                v = variant.lower()
                if re.fullmatch(r"[a-z]{4,}", v) and len(sound_key(v)) >= 4:
                    keys.setdefault(sound_key(v), set()).add(canonical)
        self.sound = {k: next(iter(c)) for k, c in keys.items() if len(c) == 1}

    @classmethod
    def from_file(cls, path):
        lexicon = json.loads(open(path, encoding="utf-8").read())
        return cls(lexicon["terms"], lexicon.get("question_frame"))

    def question_core(self, text):
        """The medical content of a question, without its framing words."""
        work = text.lower()
        for phrase in self.frame_phrases:
            work = work.replace(phrase, " ")
        words = re.findall(r"\[[^\]]+\]|[\w\u0900-\u097F-]+", work)
        core = " ".join(w for w in words if w not in self.frame_words)
        return core or text

    def canonical_terms(self, text):
        # Longest phrases first; a matched phrase is blanked out so the words inside
        # it can't match again ("खसरा का टीका" is a vaccine, not a rash). A negated
        # match ("no fever", "bukhar nahi") is blanked but not counted.
        work = text.lower().replace(NUKTA, "")
        found = []
        for variant, canonical in self.variants:
            pattern = re.compile(BOUNDARY_BEFORE + re.escape(variant) + BOUNDARY_AFTER)
            affirmed = False
            for m in pattern.finditer(work):
                before = work[max(0, m.start() - 12):m.start()]
                after = work[m.end():m.end() + 8]
                if not NEGATED_BEFORE.search(before) and not NEGATED_AFTER.search(after):
                    affirmed = True
            if not pattern.search(work):
                continue
            work = pattern.sub(lambda m: " " * len(m.group(0)), work)
            if affirmed and canonical not in found:
                found.append(canonical)
        # Then spelling variants of single words ("bukar", "bhukhar", "khaasi").
        for m in LATIN_WORD.finditer(work):
            canonical = self.sound.get(sound_key(m.group(0)))
            if not canonical or canonical in found:
                continue
            before = work[max(0, m.start() - 12):m.start()]
            after = work[m.end():m.end() + 8]
            if not NEGATED_BEFORE.search(before) and not NEGATED_AFTER.search(after):
                found.append(canonical)
        return found

    def expand(self, text):
        terms = self.canonical_terms(text)
        return f"{text} | {' '.join(t.replace('_', ' ') for t in terms)}" if terms else text
