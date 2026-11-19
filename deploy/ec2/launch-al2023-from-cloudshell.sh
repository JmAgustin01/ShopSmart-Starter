#!/bin/bash
# Launch a ShopSmart instance on Amazon Linux 2023 (packages from Amazon's own repositories).
# Run in AWS CloudShell:  NAME=shopsmart-jerry bash launch-al2023-from-cloudshell.sh
set -euo pipefail
REGION=${REGION:-ap-southeast-1}
NAME=${NAME:-shopsmart-al2023}
RAW=https://raw.githubusercontent.com/JmAgustin01/ShopSmart-Starter/aws-release
curl -fsSL -o /tmp/shopsmart-user-data-al2023.sh "$RAW/deploy/ec2/user-data-al2023.sh"

AMI=$(aws ssm get-parameter --region "$REGION" --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)
VPC=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --region "$REGION" --filters Name=group-name,Values=shopsmart-web Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" = "None" ] && { echo "Security group shopsmart-web not found: run launch-from-cloudshell.sh once first"; exit 1; }

ID=$(aws ec2 run-instances --region "$REGION" --image-id "$AMI" --instance-type t3.micro --count 1 \
  --security-group-ids "$SG" --user-data file:///tmp/shopsmart-user-data-al2023.sh \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=PDC50-ShopSmart},{Key=OS,Value=AmazonLinux2023}]" \
                       "ResourceType=volume,Tags=[{Key=Name,Value=$NAME-root},{Key=Project,Value=PDC50-ShopSmart}]" \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --region "$REGION" --instance-ids "$ID"
IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "NAME=$NAME INSTANCE=$ID IP=$IP"
echo "SITE=https://${IP//./-}.sslip.io  (setup takes about 8-10 minutes)"
