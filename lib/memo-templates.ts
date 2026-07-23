// Ready-to-use HR memo templates for the common notices a Philippine restaurant
// issues. Each fills the Subject + Content of the memo composer; blank lines
// (____) and [bracketed] placeholders are meant to be edited before sending.

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

_______________________________________________________________
(Describe the incident — date, time, and the policy/rule violated)
_______________________________________________________________

In line with company policy and due process, you are required to submit a
WRITTEN EXPLANATION within five (5) calendar days from receipt of this notice,
stating why no disciplinary action should be taken against you.

Failure to respond within the given period shall be considered a waiver of your
right to be heard.

Issued by:   ____________________
Received by: ____________________   Date: __________`,
  },
  {
    key: "attendance",
    label: "Attendance / Tardiness Warning",
    subject: "Attendance Warning",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Our records show the following attendance concern for the period
__________ to __________:

  • Tardiness:                _____ instance(s)
  • Absences (without leave): _____ day(s)
  • Undertime:                _____ instance(s)

You are reminded to observe your scheduled work hours and to file leave requests
in advance. Continued violations may result in disciplinary action.

Please treat this as a formal reminder.

Acknowledged by: ____________________   Date: __________`,
  },
  {
    key: "awol",
    label: "AWOL / Return-to-Work Notice",
    subject: "Notice of Absence Without Leave (AWOL)",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

You have been absent without approved leave since __________. As of this date,
you have incurred _____ consecutive day(s) of unauthorized absence.

You are directed to REPORT BACK TO WORK and submit a written explanation within
five (5) calendar days from receipt of this notice. Failure to do so may be
considered abandonment of employment and may result in the termination of your
services.

Issued by: ____________________`,
  },
  {
    key: "warning",
    label: "Written Warning / Disciplinary Action",
    subject: "Written Warning",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

After review of the incident dated __________ and your written explanation,
management has decided to issue a WRITTEN WARNING for the following:

  Offense:          ____________________________________________
  Policy violated:  ____________________________________________

This serves as your:   [ ] First   [ ] Second   [ ] Final warning.

A repeat of the same or a similar offense will result in a heavier penalty, up to
and including termination of employment.

Issued by:       ____________________
Acknowledged by: ____________________   Date: __________`,
  },
  {
    key: "suspension",
    label: "Suspension Notice",
    subject: "Notice of Suspension",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Following due process, you are hereby SUSPENDED WITHOUT PAY for _____ day(s),
effective __________ to __________, for the following offense:

_______________________________________________________________
_______________________________________________________________

You are expected to report back to work on __________. Any repetition of the
offense may lead to more serious disciplinary action.

Issued by: ____________________`,
  },
  {
    key: "commendation",
    label: "Commendation / Appreciation",
    subject: "Letter of Commendation",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

On behalf of management, we would like to COMMEND you for:

_______________________________________________________________
_______________________________________________________________

Your dedication and excellent performance are greatly appreciated and set a
positive example for the team. Keep up the good work!

Issued by: ____________________`,
  },
  {
    key: "schedule",
    label: "Schedule Change Notice",
    subject: "Notice of Schedule Change",
    content: `TO:    [Employee Name], [Position]
DATE:  [Date]

Please be advised that effective __________, your work schedule will be adjusted
as follows:

  From:  ____________________
  To:    ____________________

This change is due to ____________________________________________.
Kindly acknowledge receipt of this notice.

Acknowledged by: ____________________   Date: __________`,
  },
  {
    key: "announcement",
    label: "General Announcement / Circular",
    subject: "Announcement",
    content: `DATE:  [Date]
TO:    All Concerned

Please be informed of the following:

_______________________________________________________________
_______________________________________________________________
_______________________________________________________________

For questions, please coordinate with ____________________.

Thank you for your cooperation.

Management`,
  },
];
