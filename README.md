# Oracle Cloud ARM Capacity Solver

Automatically provision Oracle Cloud Infrastructure (OCI) ARM instances when capacity becomes available, solving the "Out of Capacity" issue.

## Features

- 🚀 Automatically retries instance creation when capacity is available
- 💪 Supports ARM Ampere A1 instances (4 OCPUs / 24GB RAM free tier)
- 🔄 Tries multiple availability domains
- 📝 Comprehensive logging
- ⚙️ Configurable via environment variables
- 🕐 Cron job ready for automated execution

## Prerequisites

- PHP 7.4 or higher
- Composer
- Oracle Cloud Infrastructure (OCI) account
- OCI API key pair

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd get-my-oracle-server
composer install
```

### 2. Generate OCI API Key

1. Log into OCI Console
2. Go to User Settings → API Keys
3. Click "Add API Key"
4. Download the private key (.pem file)
5. Copy the configuration details

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your OCI details:

```bash
# Required OCI Configuration
OCI_REGION=us-phoenix-1
OCI_USER_ID=ocid1.user.oc1..aaaaaaa...
OCI_TENANCY_ID=ocid1.tenancy.oc1..aaaaaaa...
OCI_KEY_FINGERPRINT=12:34:56:78:90:ab:cd:ef...
OCI_PRIVATE_KEY_FILENAME=/path/to/your/private_key.pem

# Get these from browser dev tools during instance creation
OCI_SUBNET_ID=ocid1.subnet.oc1..aaaaaaa...
OCI_IMAGE_ID=ocid1.image.oc1..aaaaaaa...

# Your SSH public key (no newlines!)
OCI_SSH_PUBLIC_KEY="ssh-rsa AAAAB3NzaC1yc2EAAA... your-email@example.com"
```

### 4. Get Subnet and Image IDs

1. Go to OCI Console → Compute → Instances → Create Instance
2. Select ARM shape (VM.Standard.A1.Flex)
3. Configure networking (uncheck "Assign public IP")
4. Open browser dev tools → Network tab
5. Click "Create" (will likely fail with "Out of Capacity")
6. Find the `/instances` API call in dev tools
7. Right-click → Copy as cURL
8. Extract `subnetId` and `imageId` from the request data

### 5. Run the Script

```bash
php index.php
```

Expected output when no capacity:
```json
{
    "code": "InternalError",
    "message": "Out of host capacity."
}
```

## Configuration Options

### Instance Shapes

**ARM Ampere A1 (Free Tier - Default):**
```bash
OCI_SHAPE=VM.Standard.A1.Flex
OCI_OCPUS=4
OCI_MEMORY_IN_GBS=24
```

**AMD x64 (Always Free Alternative):**
```bash
OCI_SHAPE=VM.Standard.E2.1.Micro
OCI_OCPUS=1
OCI_MEMORY_IN_GBS=1
```

### Advanced Options

```bash
# Maximum instances to create
OCI_MAX_INSTANCES=1

# Specific availability domain (optional)
OCI_AVAILABILITY_DOMAIN=FeVO:US-PHOENIX-1-AD-1

# Instance name prefix
OCI_DISPLAY_NAME=my-oracle-server
```

## Automation with Cron

### Setup Cron Job

```bash
# Create log file
touch /path/to/get-my-oracle-server/oci.log
chmod 777 /path/to/get-my-oracle-server/oci.log

# Edit crontab
crontab -e

# Add line to run every 5 minutes
*/5 * * * * /usr/bin/php /path/to/get-my-oracle-server/index.php >> /path/to/get-my-oracle-server/oci.log 2>&1
```

### Web-based Execution

Move to web directory and access via browser:
```bash
sudo cp -r /path/to/get-my-oracle-server /var/www/html/
curl http://localhost/get-my-oracle-server/index.php
```

## Success Output Example

```json
{
    "id": "ocid1.instance.oc1.phx.abcd...",
    "displayName": "oracle-arm-instance-20241201-123456",
    "shape": "VM.Standard.A1.Flex",
    "availabilityDomain": "FeVO:PHX-AD-1",
    "lifecycleState": "PROVISIONING",
    "shapeConfig": {
        "ocpus": 4,
        "memoryInGBs": 24
    }
}
```

## Connecting to Your Instance

Once created, connect via SSH:

```bash
# With public IP
ssh -i ~/.ssh/id_rsa opc@public.ip.address

# With private IP (from another OCI instance)
ssh -i ~/.ssh/id_rsa opc@instance-name.subnet.vcn.oraclevcn.com
```

## Troubleshooting

### Common Errors

**Private key not found:**
```bash
chmod 600 /path/to/private_key.pem
```

**Invalid SSH key:**
- Ensure no newlines in `OCI_SSH_PUBLIC_KEY`
- Use contents of `~/.ssh/id_rsa.pub` exactly

**Permission denied:**
```bash
chmod 777 /path/to/private_key.pem
```

### Rate Limiting

Avoid running more frequently than every 5 minutes to prevent API rate limiting.

## Free Tier Limits

- **ARM A1:** 4 OCPUs, 24GB RAM, 200GB storage
- **AMD x64:** 1 OCPU, 1GB RAM, 100GB storage  
- **Bandwidth:** 10TB outbound per month

## Contributing

Feel free to submit issues and pull requests.

## License

MIT License