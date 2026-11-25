<li <?= $this->app->checkMenuSelection('ModerationController', 'index', 'LanParty') ?>>
    <?= $this->url->link(t('LAN Party'), 'ModerationController', 'index', ['plugin' => 'LanParty']) ?>
</li>
