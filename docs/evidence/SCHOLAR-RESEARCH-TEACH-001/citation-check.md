# Citation check: the lesson in `enhanced-lesson.md`

Every record was fetched again by PMID from PubMed and by DOI from Crossref, apart from the run that found it (`citations-reverified.json`). Then each research sentence was read against that record's abstract. A reviewer can repeat this from the PMIDs below. Abstract text is not kept here because it may be the publisher's.

## The records are real and the details are right

| Tag | PMID | DOI | First author, journal, year | Title and DOI agree across PubMed and the lesson | Crossref agrees |
|---|---|---|---|---|---|
| E1 | 32101708 | 10.1016/j.tins.2020.01.002 | Nelson CA, Trends in Neurosciences, 2020 | Yes | Yes |
| E2 | 31447013 | 10.1016/j.pedhc.2019.04.017 | Hornor G, J Pediatric Health Care, 2019 | Yes | Yes |
| E3 | 26093365 | 10.1016/j.conb.2015.05.004 | Gervain J, Curr Opin Neurobiology, 2015 | Yes | Yes |
| E4 | 27567276 | 10.1016/j.ejpn.2016.07.007 | Ismail FY, Eur J Paediatric Neurology, 2017 | Yes | Yes |
| E5 | 28745146 | 10.1080/14616734.2017.1354040 | Granqvist P, Attachment and Human Development, 2017 | Yes | Yes |

The model never wrote a reference. Each comes from the provider's record, and the model only wrote the tag.

## Each research sentence against its abstract

| Lesson sentence (shortened) | Tag | Abstract says | Verdict |
|---|---|---|---|
| Developing brain goes through a heterochronous, cortex-specific profile, "meaning different brain regions mature at different times and rates" | E4 | Names a heterochronous, cortex-specific profile | Supported. The "meaning" clause is the model's gloss, and a fair one |
| Heightened plasticity in these periods enables construction and consolidation of experience-dependent connections, prenatal and postnatal | E4 | Says this | Supported |
| Adverse events in a critical period are likely long lasting, as a violation of the expectable environment | E1 | Says this, with "likely" | Supported, and the hedge is kept |
| Caregiver relationship is the first crucial one, and its health has a profound effect on social and emotional development | E2 | Says this | Supported |
| Insecure attachments: greater likelihood of physical health difficulties and impaired functioning into adulthood | E2 | Says this ("greater likelihood") | Supported, and the hedge is kept |
| Attachment classifications are not definitive assessments and not a fixed trait impervious to development or help | E5 | Summarises evidence that these assumptions are false and misleading | Supported. The abstract is about disorganised attachment, and the lesson names that |
| Prenatal experience with speech shapes perception and how newborns produce communicative sounds | E3 | Says this | Supported |
| Experience narrows speech perception in the first years, and neural correlates specialise | E3 | Says this | Supported |
| Key point: adverse events in a critical period are likely to have long-lasting neurobiological effects | E1 | "Long lasting" and "neurobiologically embedded" appear in separate sentences | Supported, though it joins two sentences. Noted |
| Notes and evidence: early classification as a fixed trait is false and misleading, and caregiving interventions have value | E5 | Says this | Supported |

**Result:** 10 of 10 research statements are supported by the abstract they cite, with one fair gloss and one light joining noted. This check covers one lesson. It is one person's reading, not a sampling study.

## What the automatic checks removed in that run

8 cited sentences were flagged by the claim check. 7 claimed the notes when the notes only name the idea, so they now show as Scholar's own explanation. 1 was left out. 2 further sentences of Scholar's own were left out by rule.

## Limits

- Only abstracts were read, and each reference says so.
- All five happen to be narrative reviews. The hierarchy prefers guidelines and systematic reviews, but none on these exact topics passed the relevance and applicability checks this time.
- The freshness setting of 15 years drops older foundational works such as Bowlby. Teaching them needs HQ to raise that setting. A consumer can only narrow it.
