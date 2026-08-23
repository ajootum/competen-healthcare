-- 350 WHATSAPP AS A THIRD DELIVERY KIND
--
-- Migration 224 closed kind to ('sms', 'email') on both practice_message_channel and practice_message.
-- That closure was correct and this widens it by exactly one value rather than opening it.
--
-- WHY WHATSAPP IS A KIND AND NOT A TRANSPORT FOR SMS. It carries its own consent, its own sender
-- identity, its own provider, and its own refusal reasons. A practice that has switched SMS on has not
-- thereby agreed to message patients on WhatsApp, and a patient who consented to a text has not
-- consented to a WhatsApp message from a business account. Folding it into 'sms' would make both of
-- those consents unrepresentable, which is the failure this schema's closed CHECK exists to prevent.
--
-- THE TEMPLATE TEXT DOES NOT LIVE HERE, AND THAT IS NOT A GAP WE CAN CLOSE.
--
-- WhatsApp only permits a business to START a conversation using a template Meta has approved in
-- advance. Free text is allowed only inside a 24-hour window a patient opened by writing first. So the
-- words that actually reach the handset are Meta's copy of the template, not the string this codebase
-- composes. practice_message.body therefore records OUR rendering of the same template, which is the
-- best available evidence and is not the same thing as a transcript.
--
-- provider_template_name records which approved template was invoked, so a message whose wording is
-- disputed can be traced to the version Meta held. Without it the record would assert text it cannot
-- prove was sent -- and an assertion the data does not support is the one thing this schema refuses.

alter table practice_message_channel drop constraint if exists practice_message_channel_kind_check;
alter table practice_message_channel add constraint practice_message_channel_kind_check
  check (kind in ('sms', 'email', 'whatsapp'));

alter table practice_message drop constraint if exists practice_message_kind_check;
alter table practice_message add constraint practice_message_kind_check
  check (kind in ('sms', 'email', 'whatsapp'));

-- Which Meta-approved template was invoked. Null for sms and email, where the body IS the message.
alter table practice_message add column if not exists provider_template_name text;

-- A message on a kind that carries a provider template must name it. Enforced here rather than in the
-- engine because a rule a service layer owns dies with the second writer who does not know it exists.
alter table practice_message drop constraint if exists practice_message_whatsapp_names_template;
alter table practice_message add constraint practice_message_whatsapp_names_template check (
  kind <> 'whatsapp'
  or status in ('refused', 'failed')
  or provider_template_name is not null
);

notify pgrst, 'reload schema';
