<?php

require_once 'vendor/autoload.php';

use Dotenv\Dotenv;
use Hitrov\OCI\Signer;

$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->load();
$dotenv->required([
    'OCI_REGION',
    'OCI_USER_ID', 
    'OCI_TENANCY_ID',
    'OCI_KEY_FINGERPRINT',
    'OCI_PRIVATE_KEY_FILENAME',
    'OCI_SUBNET_ID',
    'OCI_IMAGE_ID',
    'OCI_SSH_PUBLIC_KEY'
]);

$config = [
    'region' => $_ENV['OCI_REGION'],
    'user_id' => $_ENV['OCI_USER_ID'],
    'tenancy_id' => $_ENV['OCI_TENANCY_ID'],
    'key_fingerprint' => $_ENV['OCI_KEY_FINGERPRINT'],
    'private_key_filename' => $_ENV['OCI_PRIVATE_KEY_FILENAME'],
    'subnet_id' => $_ENV['OCI_SUBNET_ID'],
    'image_id' => $_ENV['OCI_IMAGE_ID'],
    'ssh_public_key' => $_ENV['OCI_SSH_PUBLIC_KEY'],
    'shape' => $_ENV['OCI_SHAPE'] ?? 'VM.Standard.A1.Flex',
    'ocpus' => (int)($_ENV['OCI_OCPUS'] ?? 4),
    'memory_in_gbs' => (int)($_ENV['OCI_MEMORY_IN_GBS'] ?? 24),
    'max_instances' => (int)($_ENV['OCI_MAX_INSTANCES'] ?? 1),
    'availability_domain' => $_ENV['OCI_AVAILABILITY_DOMAIN'] ?? null,
    'display_name' => $_ENV['OCI_DISPLAY_NAME'] ?? 'oci-arm-host-capacity'
];

function makeOciRequest($method, $endpoint, $config, $data = null) {
    $signer = new Signer($config['tenancy_id'], $config['user_id'], $config['key_fingerprint'], $config['private_key_filename']);
    
    $url = "https://iaas.{$config['region']}.oraclecloud.com{$endpoint}";
    
    $body = $data ? json_encode($data) : '';
    
    $authHeaders = $signer->getHeaders($url, $method, $body, 'application/json');
    
    // Add OPC request ID for tracking
    $opcRequestId = 'php-script-' . uniqid();
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
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        return ['code' => 0, 'response' => ['message' => "cURL error: $curlError", 'code' => 'CurlError']];
    }

    $decodedResponse = json_decode($response, true);

    // If JSON decode fails or response is empty, return raw response for debugging
    if (json_last_error() !== JSON_ERROR_NONE || empty($decodedResponse)) {
        return ['code' => $httpCode, 'response' => ['raw' => $response, 'json_error' => json_last_error_msg()]];
    }

    return ['code' => $httpCode, 'response' => $decodedResponse];
}

function getAvailabilityDomains($config) {
    $endpoint = "/20160918/availabilityDomains";
    $url = "https://identity.{$config['region']}.oraclecloud.com{$endpoint}?compartmentId={$config['tenancy_id']}";
    
    $signer = new Signer($config['tenancy_id'], $config['user_id'], $config['key_fingerprint'], $config['private_key_filename']);
    $authHeaders = $signer->getHeaders($url, 'GET');
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $authHeaders);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    if ($response === false) {
        logMessage("cURL error fetching availability domains: " . curl_error($ch));
        curl_close($ch);
        return null;
    }
    curl_close($ch);

    $data = json_decode($response, true);
    return isset($data['data']) ? $data['data'] : $data;
}

function getExistingInstances($config) {
    $endpoint = "/20160918/instances";
    $url = "https://iaas.{$config['region']}.oraclecloud.com{$endpoint}?compartmentId={$config['tenancy_id']}&lifecycleState=RUNNING";
    
    $signer = new Signer($config['tenancy_id'], $config['user_id'], $config['key_fingerprint'], $config['private_key_filename']);
    $authHeaders = $signer->getHeaders($url, 'GET');
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $authHeaders);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $response = curl_exec($ch);
    if ($response === false) {
        logMessage("cURL error fetching existing instances: " . curl_error($ch));
        curl_close($ch);
        return null;
    }
    curl_close($ch);

    $data = json_decode($response, true);

    if (!$data || !isset($data['data'])) return [];

    $instances = array_filter($data['data'], function($instance) use ($config) {
        return $instance['shape'] === $config['shape'];
    });

    return $instances;
}

function createInstance($config, $availabilityDomain) {
    $instanceData = [
        'availabilityDomain' => $availabilityDomain,
        'compartmentId' => $config['tenancy_id'],
        'metadata' => [
            'ssh_authorized_keys' => $config['ssh_public_key']
        ],
        'displayName' => $config['display_name'] . '-' . date('Ymd-His'),
        'sourceDetails' => [
            'sourceType' => 'image',
            'imageId' => $config['image_id']
        ],
        'shape' => $config['shape'],
        'createVnicDetails' => [
            'assignPublicIp' => true,
            'subnetId' => $config['subnet_id'],
            'assignPrivateDnsRecord' => true,
            'assignIpv6Ip' => false
        ],
        'isPvEncryptionInTransitEnabled' => true,
        'instanceOptions' => [
            'areLegacyImdsEndpointsDisabled' => false
        ],
        'definedTags' => new stdClass(),
        'freeformTags' => new stdClass(),
        'availabilityConfig' => [
            'recoveryAction' => 'RESTORE_INSTANCE'
        ],
        'agentConfig' => [
            'pluginsConfig' => [
                ['name' => 'Vulnerability Scanning', 'desiredState' => 'DISABLED'],
                ['name' => 'Management Agent', 'desiredState' => 'DISABLED'],
                ['name' => 'Custom Logs Monitoring', 'desiredState' => 'ENABLED'],
                ['name' => 'Compute RDMA GPU Monitoring', 'desiredState' => 'DISABLED'],
                ['name' => 'Compute Instance Monitoring', 'desiredState' => 'ENABLED'],
                ['name' => 'Compute HPC RDMA Auto-Configuration', 'desiredState' => 'DISABLED'],
                ['name' => 'Compute HPC RDMA Authentication', 'desiredState' => 'DISABLED'],
                ['name' => 'Cloud Guard Workload Protection', 'desiredState' => 'ENABLED'],
                ['name' => 'Block Volume Management', 'desiredState' => 'DISABLED'],
                ['name' => 'Bastion', 'desiredState' => 'DISABLED']
            ],
            'isMonitoringDisabled' => false,
            'isManagementDisabled' => false
        ]
    ];
    
    if ($config['shape'] === 'VM.Standard.A1.Flex') {
        $instanceData['shapeConfig'] = [
            'ocpus' => $config['ocpus'],
            'memoryInGBs' => $config['memory_in_gbs']
        ];
    }
    
    return makeOciRequest('POST', '/20160918/instances', $config, $instanceData);
}

function logMessage($message) {
    $timestamp = date('Y-m-d H:i:s');
    $logEntry = "[$timestamp] $message" . PHP_EOL;
    
    echo $logEntry;
    
    if (file_exists(__DIR__ . '/oci.log')) {
        file_put_contents(__DIR__ . '/oci.log', $logEntry, FILE_APPEND | LOCK_EX);
    }
}

logMessage("Starting Oracle Cloud ARM instance provisioning...");

while (true) {
    try {
        $existingInstances = getExistingInstances($config);

        if ($existingInstances === null) {
            logMessage("WARNING: Could not check existing instances (API/network error). Retrying in 5 minutes...");
            sleep(300);
            continue;
        }

        $instanceCount = count($existingInstances);

        logMessage("Found {$instanceCount} existing instances of shape {$config['shape']}");

        if ($instanceCount >= $config['max_instances']) {
            logMessage("Maximum instances ({$config['max_instances']}) already running. Exiting.");
            exit(0);
        }

        $availabilityDomains = getAvailabilityDomains($config);

        if (!$availabilityDomains) {
            logMessage("WARNING: Could not retrieve availability domains (API/network error). Retrying in 5 minutes...");
            sleep(300);
            continue;
        }
        
        
        $targetDomains = [];
        
        if ($config['availability_domain']) {
            $targetDomains = [$config['availability_domain']];
            logMessage("Using specified availability domain: {$config['availability_domain']}");
        } else {
            foreach ($availabilityDomains as $domain) {
                $targetDomains[] = $domain['name'];
            }
            logMessage("Will try all availability domains: " . implode(', ', $targetDomains));
        }
        
        foreach ($targetDomains as $domain) {
            logMessage("Attempting to create instance in domain: $domain");
            
            $result = createInstance($config, $domain);
            
            if ($result['code'] === 200) {
                $instance = $result['response'];
                logMessage("SUCCESS: Instance created!");
                logMessage("Instance ID: " . $instance['id']);
                logMessage("Display Name: " . $instance['displayName']);
                logMessage("Shape: " . $instance['shape']);
                logMessage("Availability Domain: " . $instance['availabilityDomain']);
                logMessage("Lifecycle State: " . $instance['lifecycleState']);
                
                if (isset($instance['shapeConfig'])) {
                    logMessage("OCPUs: " . $instance['shapeConfig']['ocpus']);
                    logMessage("Memory: " . $instance['shapeConfig']['memoryInGBs'] . " GB");
                }
                
                echo json_encode($instance, JSON_PRETTY_PRINT) . PHP_EOL;
                exit(0);
                
            } else {
                $error = $result['response'];
                $errorMsg = isset($error['message']) ? $error['message'] : 'Unknown error';
                $errorCode = isset($error['code']) ? $error['code'] : 'Unknown';
                
                // Log full response for debugging
                logMessage("Full API response: " . json_encode($result, JSON_PRETTY_PRINT));
                logMessage("FAILED in domain $domain: [$errorCode] $errorMsg");
                
                if ($errorCode === 'LimitExceeded') {
                    logMessage("Service limit exceeded. Check your tenancy limits.");
                    break;
                }
            }
        }
        
        logMessage("All availability domains exhausted. No capacity available.");
        logMessage("Waiting 5 minutes before next attempt...");
        sleep(300); // 5 minutes = 300 seconds
        
    } catch (Exception $e) {
        logMessage("EXCEPTION: " . $e->getMessage());
        logMessage("Waiting 5 minutes before retrying...");
        sleep(300);
    }
}