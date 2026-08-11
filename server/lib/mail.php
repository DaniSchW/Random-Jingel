<?php
/* Plain PHP mail() - no SMTP credentials configured (explicit tradeoff:
 * simpler setup, but shared-hosting sending IPs commonly land in spam
 * folders at large providers like Gmail/Outlook). Swap this function's
 * body for an SMTP library later without touching any caller.
 */

function rj_send_magic_link_email(string $toEmail, string $link): bool {
  $cfg = rj_config();
  $subject = 'Dein Anmelde-Link für Random Jingle';
  $body = "Hallo,\n\n"
    . "mit diesem Link meldest du dich bei Random Jingle an:\n\n"
    . $link . "\n\n"
    . "Der Link ist " . $cfg['AUTH_TOKEN_TTL_MINUTES'] . " Minuten gültig und nur einmal verwendbar.\n"
    . "Falls du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail ignorieren.\n\n"
    . "— Random Jingle";

  $fromName = mb_encode_mimeheader($cfg['MAIL_FROM_NAME'], 'UTF-8');
  $headers = "From: {$fromName} <{$cfg['MAIL_FROM']}>\r\n"
    . "Content-Type: text/plain; charset=UTF-8\r\n";

  return mail($toEmail, mb_encode_mimeheader($subject, 'UTF-8'), $body, $headers);
}
