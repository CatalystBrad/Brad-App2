# Question wordings to check against the official TA6

The source PDF is a filled-in form: most question text extracted cleanly, but
a few labels sat in image or font-encoded runs that did not yield text. Those
questions were reconstructed from the surrounding structure and from the
standard TA6 question set. They are flagged `"verify": true` in
`data/ta6-questions.json`.

**Check each of these against the official Law Society TA6 (6th edition, 2025)
before the form is used on a live transaction.** The logic around them is
correct; only the wording is in doubt.

| TA6 no. | Section | Our wording |
|---|---|---|
| 6.1 | guarantees | Which of these guarantees or warranties are still running on the property? Tick what you have. |
| 7.2 | insurance | Has buildings insurance ever been refused, loaded with a high excess, or gone up sharply because of the property itself? |
| 8.2 | environment | Has a flood risk report or assessment been obtained for the property? |
| 11.2 | services | Do you have a certificate from the electrician for that work? |
| 11.7(g) | services | Has the system been replaced or upgraded since January 2020, or does it meet the General Binding Rules? |
| 13.5 | transaction | Is any part of the property let out under a tenancy that is not being sold with it? |
| 14.1 | completion | Is there a mortgage on the property that will be paid off when you sell? |
| 14.2(b) | completion | Will everything included in the sale be left in the condition listed on the fittings and contents form? |
| 14.2(c) | completion | Will anything you are taking with you, including anything fixed in place, be removed without leaving damage? |

Everything else in the bank was extracted from the supplied PDF.
