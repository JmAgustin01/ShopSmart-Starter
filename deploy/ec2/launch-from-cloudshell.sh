#!/bin/bash
# Launch the ShopSmart demo instance. Run in AWS CloudShell (it already has your AWS sign-in):
#   curl -fsSL https://raw.githubusercontent.com/JmAgustin01/ShopSmart-Starter/aws-release/deploy/ec2/launch-from-cloudshell.sh | bash
# Creates: 1 security group (shopsmart-web) and 1 t3.micro instance (shopsmart-demo). No key pair, no secrets.
set -euo pipefail
REGION=${REGION:-ap-southeast-1}
BRANCH_RAW=https://raw.githubusercontent.com/JmAgustin01/ShopSmart-Starter/aws-release
curl -fsSL -o /tmp/shopsmart-user-data.sh "$BRANCH_RAW/deploy/ec2/user-data.sh"

AMI=$(aws ssm get-parameter --region "$REGION" --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)

SG=$(aws ec2 describe-security-groups --region "$REGION" --filters Name=group-name,Values=shopsmart-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC" --group-name shopsmart-web \
    --description "ShopSmart demo: 80/443 public; SSH only from EC2 Instance Connect" \
    --tag-specifications 'ResourceType=security-group,Tags=[{Key=Project,Value=PDC50-ShopSmart}]' --query GroupId --output text)
  # Public web entry point only. Ports 3000 (Express) and 5432 (PostgreSQL) are NOT opened.
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP redirect and certificate check}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]' >/dev/null
  # Admin access: SSH only from AWS's EC2 Instance Connect service range, not from the whole internet.
  PL=$(aws ec2 describe-managed-prefix-lists --region "$REGION" --filters Name=prefix-list-name,Values="com.amazonaws.$REGION.ec2-instance-connect" --query 'PrefixLists[0].PrefixListId' --output text)
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$PL,Description=EC2 Instance Connect}]" >/dev/null
fi

ID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" --instance-type t3.micro --count 1 \
  --security-group-ids "$SG" --user-data file:///tmp/shopsmart-user-data.sh \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=shopsmart-demo},{Key=Project,Value=PDC50-ShopSmart},{Key=Owner,Value=JM},{Key=RemoveBy,Value=2026-11-30}]' \
                       'ResourceType=volume,Tags=[{Key=Name,Value=shopsmart-demo-root},{Key=Project,Value=PDC50-ShopSmart}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --region "$REGION" --instance-ids "$ID"
IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "REGION=$REGION SG=$SG INSTANCE=$ID IP=$IP"
echo "SITE=https://${IP//./-}.sslip.io  (setup takes about 8-10 minutes)"
