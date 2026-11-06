# Citation check: the lesson in `enhanced-lesson.md`

Every record was fetched again by PMID from PubMed and by DOI from Crossref, apart from the run that found it (`citations-reverified.json`). Then each research sentence was read against that record's abstract. A reviewer can repeat this from the PMIDs below. Abstract text is not kept here because it may be the publisher's.

## The records are real and the details are right

| Tag | PMID | DOI | First author, journal, year | Title and DOI agree with PubMed | Crossref agrees |
|---|---|---|---|---|---|
| E1 | 32101708 | 10.1016/j.tins.2020.01.002 | Nelson CA, Trends in Neurosciences, 2020 | Yes | Yes |
| E3 | 26093365 | 10.1016/j.conb.2015.05.004 | Gervain J, Curr Opin Neurobiology, 2015 | Yes | Yes |
| E4 | 29752957 | 10.1016/j.neubiorev.2018.05.009 | Hadders-Algra M, Neurosci Biobehav Rev, 2018 | Yes | Yes |
| E6 | 28745146 | 10.1080/14616734.2017.1354040 | Granqvist P, Attachment and Human Development, 2017 | Yes | Yes |

The pack held 6 records. E2 and E5 were given to the model, but their sentences were left out by the checks, so they are not listed as references on the lesson. The model never wrote a reference: each comes from the provider's record, and the model only wrote the tag.

## Each research sentence against its abstract

| Lesson sentence (shortened) | Tag | Abstract says | Verdict |
|---|---|---|---|
| From fetal age, motor behaviour rests on spontaneous activity in brainstem and spinal cord, then shaped by cortical activity | E4 | Says this | Supported |
| Adverse events violating what the brain expects, in a critical period, likely to have long-lasting effects on development | E1 | Says this, with "likely" | Supported, and the hedge is kept |
| Attachment classification is not a fixed trait and not impervious to development or intervention | E6 | Summarises evidence that this assumption is false and misleading. The abstract's "fixed trait" point is about disorganised attachment, and the sentence names disorganised attachment | Supported |
| Speech experience begins before birth, shapes newborn perception and production, and narrows toward the native language | E3 | Says this | Supported |

**Result: 4 of 4 research sentences are supported by the abstract they cite.** This is one person's reading of one lesson, not a sampling study.

## What this check found on the way

**The automatic claim check is good but not complete, and the lesson varies between runs.** On the run before this one, the checks passed three sentences that went on past their abstract, for example "which is consistent with this centre-outward, head-to-toe sequence". That is a citation claiming more than its abstract says. So:

- the writing prompt now says a connection to the lesson is its own `[AI]` sentence;
- the claim check is told to read every clause;
- a sentence citing research that ends in such a clause is now left out by rule.

In this final run the claim check flagged 6 sentences. 3 that claimed the notes became Scholar's own, and 3 were left out. One more was left out by rule. That is why fewer records are cited here than on earlier runs.

**A reader should still expect the occasional overreach to get through.** The check is a second model reading abstracts, and a rule can only catch known wordings.

## Limits

- Only abstracts were read, and each reference says so.
- All the cited records are narrative reviews. The hierarchy prefers guidelines and systematic reviews, but none on these exact topics passed the relevance and applicability checks and also reached the pack.
- The freshness setting of 15 years drops older foundational works such as Bowlby. Teaching them needs HQ to raise that setting. A consumer can only narrow it.
