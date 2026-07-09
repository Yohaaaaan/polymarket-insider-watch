<?php
$ch = curl_init('https://identity.eu-marseille-1.oraclecloud.com/20160918/availabilityDomains');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$res = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "Code: $code\n";
echo "Error: $err\n";
echo "Response Length: " . strlen($res) . "\n";
if ($code === 401) {
    echo "Success (401 is expected as we have no auth headers)\n";
} else {
    echo "Response: $res\n";
}
