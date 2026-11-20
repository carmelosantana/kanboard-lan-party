<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\LanParty\Plugin;

// Tag == plugin.json == getPluginVersion(): drift across the three is the most common release defect.
class PluginVersionTest extends Base
{
    public function testVersionsAgree(): void
    {
        $json = json_decode(file_get_contents(__DIR__.'/../plugin.json'), true);
        $this->assertSame('0.1.0', $json['version']);
        $this->assertSame($json['version'], (new Plugin($this->container))->getPluginVersion());
        $this->assertSame([], $json['requires']);
        $this->assertSame(
            [['plugin' => 'Agents', 'min_version' => '0.5.0', 'reason' => 'keeps agent users off the leaderboards']],
            $json['recommends']
        );
    }
}
