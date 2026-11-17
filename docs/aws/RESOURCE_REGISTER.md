# AWS Account and Resource Register

No credentials, account passwords or connection strings are recorded here.

## Account plan (checked 17 Nov 2026, Billing and Cost Management)

| Item | Value |
|---|---|
| Plan | **Free plan.** The console states "Your free plan account does not get charged" |
| Credits | **US$100.00** remaining, US$0.00 used (credit "AWS Free Tier", issued 9 Nov 2026, expires 9 Nov 2027) |
| Free access ends | **9 May 2027** (or earlier if credits run out) |
| Who manages AWS | John Michael Agustin (account owner). No other AWS users were created for this demo |
| Evidence | `screenshots/aws-credits.png` (account number cropped) |

## Resources created

All are in **ap-southeast-1 (Asia Pacific, Singapore)** and tagged `Project=PDC50-ShopSmart`.

| Service | Resource | Purpose | Created | Owner | Planned removal |
|---|---|---|---|---|---|
| EC2 | Instance `shopsmart-demo` (`i-072c46409595ea461`), t3.micro, Ubuntu 24.04 | Runs Caddy, the Express API, the built frontend and PostgreSQL | 17 Nov 2026 | JM | **by 30 Nov 2026** (tag `RemoveBy`) |
| EBS | 20 GB gp3 root volume (`shopsmart-demo-root`) | Operating system, app and database files | 17 Nov 2026 | JM | Deleted automatically with the instance (`DeleteOnTermination=true`) |
| EC2 | Public IPv4 address (auto-assigned, 13.212.160.135) | Public address for `13-212-160-135.sslip.io` | 17 Nov 2026 | JM | Released when the instance is terminated |
| VPC | Security group `shopsmart-web` (`sg-0e181ee165cf19c8a`) in the default VPC | 443/80 public; 22 from EC2 Instance Connect only | 17 Nov 2026 | JM | Delete after the instance |
| CloudShell | Home directory files `launch.sh`, `launch-output.txt` | Launch script and its output | 17 Nov 2026 | JM | Optional cleanup; deleted by AWS after 120 days without use |

Not created: RDS, Amplify, S3, Elastic IP, load balancer, key pair, IAM users or roles.

## Expected cost

On the Free plan these are paid from credits, not billed. The estimate is about **US$0.40–0.50 per day** while running: a t3.micro instance (~US$0.013/h), a public IPv4 address (~US$0.005/h) and 20 GB of gp3 storage. A two-week demo uses roughly US$6–7 of the US$100 credit. Check **Billing → Credits** again before the demo and after removal.

## Removal plan

Run in CloudShell (`ap-southeast-1`) after grading:

```bash
aws ec2 terminate-instances --region ap-southeast-1 --instance-ids i-072c46409595ea461
aws ec2 wait instance-terminated --region ap-southeast-1 --instance-ids i-072c46409595ea461
aws ec2 delete-security-group --region ap-southeast-1 --group-id sg-0e181ee165cf19c8a
```

Then confirm: **EC2 → Instances** shows it terminated, **EC2 → Volumes** shows no `shopsmart-demo-root`, and **Security groups** no longer lists `shopsmart-web`. Terminating deletes the database with the instance, which is intended: it only holds fictional data. Take a `pg_dump` first if the orders need to be kept as evidence.
