<?php
namespace Kanboard\Plugin\LanParty\Model;

// `code` is a frozen wire string: bad_request, missing, rate_limited, unavailable or too_large.
// Exception::$code cannot be redeclared readonly or typed, so it is widened to public and only set here.
class ScoreRejected extends \RuntimeException
{
    /** @var string */
    public $code;

    public function __construct(string $code, string $message)
    {
        parent::__construct($message);
        $this->code = $code;
    }
}
