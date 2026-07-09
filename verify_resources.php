<?php

require_once 'vendor/autoload.php';

use Dotenv\Dotenv;
use Hitrov\OCI\Signer;

// Load environment variables
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();

// Configuration
$region = $_ENV['OCI_REGION'];
$tenancyId = $_ENV['OCI_TENANCY_ID'];
$userId = $_ENV['OCI_USER_ID'];
$keyFingerprint = $_ENV['OCI_KEY_FINGERPRINT'];
$privateKeyFilename = $_ENV['OCI_PRIVATE_KEY_FILENAME'];

echo "=== OCI Resource Verification ===\n";
echo "Region: $region\n";
echo "Tenancy: $tenancyId\n";
echo "User: $userId\n";
echo "Key Fingerprint: $keyFingerprint\n";
echo "Private Key: $privateKeyFilename\n\n";

// Check if private key exists and is readable
if (!file_exists($privateKeyFilename)) {
    echo "❌ ERROR: Private key file not found: $privateKeyFilename\n";
    exit(1);
}

if (!is_readable($privateKeyFilename)) {
    echo "❌ ERROR: Private key file not readable: $privateKeyFilename\n";
    echo "Try: chmod 600 $privateKeyFilename\n";
    exit(1);
}

echo "✅ Private key file is accessible\n\n";

// Function to make API call using the same approach as index.php
function makeOciRequest($method, $endpoint, $config, $data = null) {
    $signer = new Signer($config['tenancy_id'], $config['user_id'], $config['key_fingerprint'], $config['private_key_filename']);
    
    $url = "https://iaas.{$config['region']}.oraclecloud.com{$endpoint}?compartmentId={$config['tenancy_id']}";
    
    $body = $data ? json_encode($data) : '';
    
    $authHeaders = $signer->getHeaders($url, $method, $body, 'application/json');
    
    // Add OPC request ID for tracking
    $opcRequestId = 'verify-script-' . uniqid();
    $authHeaders[] = "opc-request-id: $opcRequestId";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $authHeaders);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    if ($data) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    $decodedResponse = json_decode($response, true);
    
    return ['code' => $httpCode, 'response' => $decodedResponse, 'raw' => $response];
}

// Function to make Identity API call
function makeIdentityRequest($endpoint, $config) {
    $signer = new Signer($config['tenancy_id'], $config['user_id'], $config['key_fingerprint'], $config['private_key_filename']);
    
    $url = "https://identity.{$config['region']}.oraclecloud.com{$endpoint}?compartmentId={$config['tenancy_id']}";
    
    $authHeaders = $signer->getHeaders($url, 'GET');
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $authHeaders);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    $decodedResponse = json_decode($response, true);
    
    return ['code' => $httpCode, 'response' => $decodedResponse, 'raw' => $response];
}

$config = [
    'region' => $region,
    'tenancy_id' => $tenancyId,
    'user_id' => $userId,
    'key_fingerprint' => $keyFingerprint,
    'private_key_filename' => $privateKeyFilename
];

// Test 1: List Availability Domains
echo "1. Testing Availability Domains...\n";
$adResult = makeIdentityRequest('/20160918/availabilityDomains', $config);
if ($adResult['code'] === 200 && isset($adResult['response']['data'])) {
    echo "✅ Availability Domains found:\n";
    foreach ($adResult['response']['data'] as $ad) {
        echo "   - {$ad['name']}\n";
    }
} else {
    echo "❌ Failed to get Availability Domains\n";
    echo "   HTTP Code: {$adResult['code']}\n";
    echo "   Response: {$adResult['raw']}\n";
}
echo "\n";

// Test 2: List Subnets
echo "2. Testing Subnets...\n";
$subnetResult = makeOciRequest('GET', '/20160918/subnets', $config);
if ($subnetResult['code'] === 200 && isset($subnetResult['response']['data'])) {
    echo "✅ Subnets found:\n";
    foreach ($subnetResult['response']['data'] as $subnet) {
        echo "   - {$subnet['displayName']} ({$subnet['id']})\n";
        echo "     VCN: {$subnet['vcnId']}\n";
        echo "     CIDR: {$subnet['cidrBlock']}\n";
        echo "     AD: {$subnet['availabilityDomain']}\n\n";
    }
} else {
    echo "❌ Failed to get Subnets\n";
    echo "   HTTP Code: {$subnetResult['code']}\n";
    echo "   Response: {$subnetResult['raw']}\n";
}

// Test 3: List Images
echo "3. Testing Images...\n";
$imageResult = makeOciRequest('GET', '/20160918/images', $config);
if ($imageResult['code'] === 200 && isset($imageResult['response']['data'])) {
    echo "✅ Images found:\n";
    foreach ($imageResult['response']['data'] as $image) {
        if (strpos($image['displayName'], 'Oracle Linux') !== false || 
            strpos($image['displayName'], 'Ubuntu') !== false ||
            strpos($image['displayName'], 'Canonical') !== false) {
            echo "   - {$image['displayName']} ({$image['id']})\n";
            echo "     OS: {$image['operatingSystem']}\n";
            echo "     Version: {$image['operatingSystemVersion']}\n";
            echo "     Architecture: {$image['architecture']}\n\n";
        }
    }
} else {
    echo "❌ Failed to get Images\n";
    echo "   HTTP Code: {$imageResult['code']}\n";
    echo "   Response: {$imageResult['raw']}\n";
}

// Test 4: List Instances
echo "4. Testing Instances...\n";
$instanceResult = makeOciRequest('GET', '/20160918/instances', $config);
if ($instanceResult['code'] === 200 && isset($instanceResult['response']['data'])) {
    echo "✅ Instances found:\n";
    foreach ($instanceResult['response']['data'] as $instance) {
        echo "   - {$instance['displayName']} ({$instance['id']})\n";
        echo "     Shape: {$instance['shape']}\n";
        echo "     State: {$instance['lifecycleState']}\n";
        echo "     AD: {$instance['availabilityDomain']}\n\n";
    }
} else {
    echo "❌ Failed to get Instances\n";
    echo "   HTTP Code: {$instanceResult['code']}\n";
    echo "   Response: {$instanceResult['raw']}\n";
}

echo "=== Verification Complete ===\n";
echo "\nIf you see errors above, check:\n";
echo "1. Your OCI credentials are correct\n";
echo "2. Your user has proper permissions\n";
echo "3. Your region is correct\n";
echo "4. Your private key is valid\n";
echo "\nUse the subnet and image IDs from the lists above to update your .env file.\n";
