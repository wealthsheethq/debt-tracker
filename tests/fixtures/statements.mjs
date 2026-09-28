// SYNTHETIC statement text for the Statement Snap tests. Every name, address, account number and amount here is
// made up. The layouts follow the typical wording of each issuer's statements; none of this is a real statement.

// Amex Platinum: a charge card with no preset spending limit, Pay Over Time, two-digit years, "Next Closing Date".
export const amexPlatinum = `
American Express
The Platinum Card®
Prepared for
JORDAN Q SAMPLE
Account Ending 7-81004
Closing Date 09/18/26
Next Closing Date 10/18/26
New Balance $4,812.37
Minimum Payment Due $512.40
Payment Due Date 10/13/26
Late Payment Warning: If we do not receive your Minimum Payment Due by the Payment Due Date listed above, you may have to pay a late fee of up to $40.00.
No Preset Spending Limit
Pay Over Time Limit $35,000.00
Available Pay Over Time Limit $32,300.00
JORDAN Q SAMPLE
123 SAMPLE ST APT 4
SPRINGFIELD IL 62704-0000
Account Summary
Pay In Full Portion $2,112.37
Pay Over Time Balance $2,700.00
Previous Balance $3,390.12
Payments/Credits -$3,390.12
New Charges +$4,762.25
Fees +$0.00
Interest Charged +$50.12
Detail
09/02/26 BLUE BOTTLE COFFEE OAKLAND CA $6.50
09/05/26 DELTA AIR LINES ATLANTA GA $412.30
09/11/26 WHOLE FOODS MARKET SPRINGFIELD IL $88.14
Interest Charge Calculation
Days in Billing Period: 31
Annual Percentage Rate Balance Subject to Interest Rate Interest Charge
Pay Over Time 22.49% (v) $2,650.00 $50.12
Cash Advances 29.24% (v) $0.00 $0.00
Total $50.12
Total Fees for this Period $0.00
Total Interest Charged for this Period $50.12
`;

// Amex Blue Cash Preferred: revolving, credit limit, a promo APR, four-digit years, next closing date on the same line.
export const amexBCP = `
Blue Cash Preferred® Card from American Express
Prepared for RILEY T EXAMPLE
Account Ending 3-21007
Closing Date 09/12/2026   Next Closing Date 10/12/2026
New Balance $2,431.88
Minimum Payment Due $40.00
Payment Due Date 10/07/2026
Credit Limit $15,000.00
Available Credit $12,568.12
Cash Advance Limit $3,000.00
Minimum Payment Warning: If you make only the minimum payment each period, you will pay more in interest and it will take you longer to pay off your balance.
Only the minimum payment 9 years $4,011
Account Summary
Previous Balance $2,105.40
Payments/Credits -$500.00
New Charges +$807.36
Fees +$0.00
Interest Charged +$19.12
Promotional APR on Purchases 0.00% expires 11/12/2026
Interest Charge Calculation
Annual Percentage Rate Balance Subject to Interest Rate Interest Charge
Purchases 19.24% (v) $1,210.00 $19.12
Promotional Purchases 0.00% $1,100.00 $0.00
Cash Advances 29.24% (v) $0.00 $0.00
Total Fees for this Period $0.00
Total Interest Charged for this Period $19.12
Fees
Total Fees in 2026 $0.00
Total Interest in 2026 $143.90
10/01/26 TRADER JOE'S #123 PORTLAND OR $54.21
`;

// Capital One Savor: billing cycle range with month names, year-to-date totals, a cash-advance limit.
export const capitalOneSavor = `
Capital One
Savor Card | World Elite Mastercard
Account ending in 4821
Aug 19, 2026 - Sep 18, 2026 | 31 days in Billing Cycle
Payment Due Date: Oct 13, 2026
New Balance $1,876.54
Minimum Payment Due $49.00
Credit Limit $8,500.00
Available Credit $6,623.46
Cash Advance Credit Limit $1,700.00
Available Credit for Cash Advances $1,700.00
CASEY M TESTER
42 PLACEHOLDER RD
RIVERTON WY 82501
Account Summary
Previous Balance $1,402.10
Payments -$1,000.00
Other Credits -$0.00
Transactions +$1,442.03
Cash Advances +$0.00
Fees Charged +$0.00
Interest Charged +$32.41
Transactions
Sep 3 SQ *CORNER BAKERY RIVERTON WY $12.75
Sep 9 NETFLIX.COM LOS GATOS CA $15.49
Interest Charge Calculation
Your Annual Percentage Rate (APR) is the annual interest rate on your account.
Type of Balance Annual Percentage Rate (APR) Balance Subject to Interest Rate Interest Charge
Purchases 29.74% D $1,339.56 $32.41
Cash Advances 29.74% D $0.00 $0.00
Totals Year-to-Date
Total Fees charged in 2026 $0.00
Total Interest charged in 2026 $214.88
`;

// The same Capital One statement as OCR might read a photo of it: O for 0, l for 1, missing spaces.
export const capitalOneSavorOCR = `
CapitalOne
Savor Card
Accountendingin 4821
Aug l9, 2O26 - Sep 18, 2O26 | 3l days in Billing Cycle
PaymentDueDate:Oct13,2O26
NewBalance$l,876.54
MinimumPaymentDue $49.OO
CreditLimit $8,5OO.OO
Avai1ableCredit $6,623.46
PreviousBalance $1,4O2.1O
FeesCharged +$O.OO
InterestCharged +$32.4l
Purchases 29.74% D $1,339.56 $32.4l
`;

// Capital One, the next month, paid off: a $0 balance.
export const capitalOneZero = `
Capital One
Savor Card
Account ending in 4821
Sep 19, 2026 - Oct 18, 2026 | 30 days in Billing Cycle
Payment Due Date: Nov 13, 2026
New Balance $0.00
Minimum Payment Due $0.00
Credit Limit $8,500.00
Available Credit $8,500.00
Previous Balance $1,876.54
Payments -$1,876.54
Fees Charged +$0.00
Interest Charged +$0.00
Purchases 29.74% D $0.00 $0.00
`;

// Apple Card (Goldman Sachs): calendar-month statement, "Total Balance", no printed account number.
export const appleCard = `
Apple Card
Issued by Goldman Sachs Bank USA, Salt Lake City Branch
Statement Aug 1 - Aug 31, 2026
Morgan Placeholder
Total Balance as of Aug 31, 2026 $1,203.19
Minimum Payment Due by Sep 30, 2026 $30.00
Credit Limit $6,000.00
Available Credit $4,796.81
Previous Total Balance $954.20
Payments -$954.20
Credits -$0.00
New Charges +$1,203.19
Interest Charged $0.00
Transactions
Aug 4 APPLE.COM/BILL CUPERTINO CA $2.99
Aug 12 UBER TRIP SAN FRANCISCO CA $23.40
Interest Charge Calculation
Annual Percentage Rate (APR) Purchases 24.99% (v)
`;

// Robinhood Gold Card: "Statement Balance", named-month range with the year only at the end.
export const robinhoodGold = `
Robinhood Gold Card
Visa Signature
Card ending in 5519
Statement Period Aug 19 - Sep 18, 2026
Statement Balance $3,120.45
Minimum Payment Due $95.00
Payment Due Date Oct 15, 2026
Credit Limit $12,000.00
Available Credit $8,879.55
Previous Balance $2,845.00
Payments -$1,000.00
Purchases +$1,214.25
Interest Charged $61.20
Fees Charged $0.00
Purchase APR 27.24%
Cash Advance APR 30.24%
`;

// Robinhood, the month after: APR up, a late fee, a higher minimum, a lower limit, balance up.
export const robinhoodGoldNext = `
Robinhood Gold Card
Card ending in 5519
Statement Period Sep 19 - Oct 18, 2026
Statement Balance $3,410.80
Minimum Payment Due $140.00
Payment Due Date Nov 14, 2026
Credit Limit $10,000.00
Available Credit $6,589.20
Previous Balance $3,120.45
Interest Charged $70.35
Fees Charged $40.00
Purchase APR 29.24%
Cash Advance APR 30.24%
`;

// Unknown issuer: the generic reader. Full account number (fake), Opening/Closing range, "Credit Line", a promo with month/year.
export const genericCreditUnion = `
FIRST PRAIRIE CREDIT UNION
Visa Signature Statement
Account Number: 4000 1234 5678 9012
Opening/Closing Date 08/19/26 - 09/18/26
New Balance $912.66
Minimum Payment Due $25.00
Payment Due Date 10/15/26
Credit Line $5,000.00
Available Credit $4,087.34
Previous Balance $1,150.00
Interest Charged $14.05
Fees Charged $29.00
Annual Percentage Rate (APR) for Purchases 21.99%
Balance Transfer Intro APR 0.00% until 03/2027
`;

// Unknown issuer, header-style layout: each label on its own line with the value below; full month names.
export const genericHeaders = `
MERIDIAN BANK REWARDS CARD
Card Number XXXX XXXX XXXX 7710
Statement Closing Date
September 18, 2026
Please Pay By
October 13, 2026
New Balance
$2,045.10
Minimum Amount Due
$61.00
Total Credit Line
$9,000.00
Available Credit
$6,954.90
Purchase APR
23.49%
Interest Charged
$38.77
`;

// Every string in these fixtures that must never reach saved data.
export const PRIVATE_BITS = ['7-81004', '781004', '3-21007', '4000 1234 5678 9012', '4000123456789012', 'JORDAN', 'SAMPLE ST', 'SPRINGFIELD', 'RILEY', 'CASEY',
  'PLACEHOLDER RD', 'Morgan Placeholder', 'BLUE BOTTLE', 'DELTA AIR', 'WHOLE FOODS', 'NETFLIX', 'CORNER BAKERY', 'APPLE.COM', 'UBER TRIP', "TRADER JOE'S", 'Goldman', 'Late Payment Warning'];
