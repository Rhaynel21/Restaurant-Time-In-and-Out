// Ready-to-use HR memo templates for the common notices a Philippine restaurant
// issues. Each fills the Subject + Content of the memo composer. Bracketed
// prompts are intentionally easy to click, select, and replace while editing.

export type MemoTemplate = { key: string; label: string; subject: string; content: string };

export const MEMO_TEMPLATES: MemoTemplate[] = [
  {
    key: "nte",
    label: "Notice to Explain (NTE)",
    subject: "Notice to Explain",
    content: `TO:      [Employee Name], [Position]
DATE:    [Date]
RE:      Notice to Explain

This is to formally notify you regarding the following incident:

[Type the incident details, including the date, time, and policy/rule violated]

In line with company policy and due process, you are required to submit a
WRITTEN EXPLANATION within five (5) calendar days from receipt of this notice,
stating why no disciplinary action should be taken against you.

Failure to respond within the given period shall be considered a waiver of your
right to be heard.

Issued by:   [Name and position]
Received by: [Employee signature/name]   Date: [Date received]`,
  },
  {
    key: "attendance",
    label: "Attendance / Tardiness Warning",
    subject: "Attendance Warning",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Our records show the following attendance concern for the period
[Start date] to [End date]:

  • Tardiness:                [Number] instance(s)
  • Absences (without leave): [Number] day(s)
  • Undertime:                [Number] instance(s)

You are reminded to observe your scheduled work hours and to file leave requests
in advance. Continued violations may result in disciplinary action.

Please treat this as a formal reminder.

Acknowledged by: [Employee signature/name]   Date: [Date acknowledged]`,
  },
  {
    key: "awol",
    label: "AWOL / Return-to-Work Notice",
    subject: "Notice of Absence Without Leave (AWOL)",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

You have been absent without approved leave since [First date of absence]. As of
this date, you have incurred [Number] consecutive day(s) of unauthorized absence.

You are directed to REPORT BACK TO WORK and submit a written explanation within
five (5) calendar days from receipt of this notice. Failure to do so may be
considered abandonment of employment and may result in the termination of your
services.

Issued by: [Name and position]`,
  },
  {
    key: "warning",
    label: "Written Warning / Disciplinary Action",
    subject: "Written Warning",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

After review of the incident dated [Incident date] and your written explanation,
management has decided to issue a WRITTEN WARNING for the following:

  Offense:          [Type the offense]
  Policy violated:  [Type the policy or rule violated]

This serves as your:   [ ] First   [ ] Second   [ ] Final warning.

A repeat of the same or a similar offense will result in a heavier penalty, up to
and including termination of employment.

Issued by:       [Name and position]
Acknowledged by: [Employee signature/name]   Date: [Date acknowledged]`,
  },
  {
    key: "suspension",
    label: "Suspension Notice",
    subject: "Notice of Suspension",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Following due process, you are hereby SUSPENDED WITHOUT PAY for [Number] day(s),
effective [Start date] to [End date], for the following offense:

[Type the offense and the reason for suspension]

You are expected to report back to work on [Return-to-work date]. Any repetition of the
offense may lead to more serious disciplinary action.

Issued by: [Name and position]`,
  },
  {
    key: "commendation",
    label: "Commendation / Appreciation",
    subject: "Letter of Commendation",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

On behalf of management, we would like to COMMEND you for:

[Type the achievement, contribution, or positive performance]

Your dedication and excellent performance are greatly appreciated and set a
positive example for the team. Keep up the good work!

Issued by: [Name and position]`,
  },
  {
    key: "schedule",
    label: "Schedule Change Notice",
    subject: "Notice of Schedule Change",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Please be advised that effective [Effective date], your work schedule will be adjusted
as follows:

  From:  [Current work schedule]
  To:    [New work schedule]

This change is due to [Reason for schedule change].
Kindly acknowledge receipt of this notice.

Acknowledged by: [Employee signature/name]   Date: [Date acknowledged]`,
  },
  {
    key: "announcement",
    label: "General Announcement / Circular",
    subject: "Announcement",
    content: `DATE:  [Date]
TO:    All Concerned

Please be informed of the following:

[Type the complete announcement here]

For questions, please coordinate with [Contact person or department].

Thank you for your cooperation.

Management`,
  },
];
