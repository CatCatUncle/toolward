# Licensing

[中文版本](LICENSING.zh-CN.md)

Toolward is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).

**Free forever for noncommercial use. Any use by or for a company needs a commercial licence.**

## Free, no licence needed

You may use, copy, modify and redistribute Toolward at no cost, for any
*noncommercial* purpose. That includes:

- Personal projects, your own dotfiles, your own agent setup.
- Learning, teaching, coursework, academic research.
- Charitable organisations, public-benefit work and government agencies —
  PolyForm names these as permitted purposes explicitly.
- Contributing to Toolward itself, and auditing open-source projects you maintain
  in your own time.

No registration, no key, no telemetry. Toolward never phones home.

## Needs a commercial licence

Anything done for the benefit of a business is commercial use, whoever runs the
command. The common cases:

- Running `toolward` against a company's repositories, agents or MCP servers,
  including on your own laptop during work hours.
- Running it in a company's CI, on a build server, or in an internal platform.
- Consultancies and security firms running it as part of client engagements.
- Offering Toolward, or a service built on it, to third parties — hosted, SaaS,
  managed or bundled into another product.
- Redistributing Toolward inside a commercial product or paid course.

> Rule of thumb: if someone is being paid for the work that Toolward is part of,
> you need a licence.

There is one deliberate exception, below.

## The 30-day evaluation exception

Any company may use Toolward for **up to 30 days** to evaluate whether to buy a
licence, without paying and without asking. Use it in CI, scan your whole
estate, run it past your security team. If you keep using it after 30 days, buy
a licence.

## Buying a licence

Commercial licences are per-organisation and perpetual for the version range
they cover; they include the right to run Toolward in CI on unlimited
repositories inside that organisation.

Write to **licensing@aijentra.com** with your organisation's name, rough size,
and how you plan to use it. Startups under 10 people and pre-revenue companies
get a substantial discount — say so in the first email.

If you cannot afford a licence and the work is genuinely for the public good,
write anyway and say so. That mail gets answered.

## Frequently asked

**Is this open source?**
No — not by the OSI definition, because of the noncommercial restriction.
Toolward is *source-available*: the full source is public, you can read it, fork
it, patch it and ship your patches. Please do not call it "open source" in
places where that word carries a legal meaning.

**Can I fork it and relicense?**
No. Forks stay under the same terms, and you must keep the `Required Notice`
line from the LICENSE file.

**I am an employee scanning my personal side project.**
That is noncommercial use. Free.

**I am a freelancer scanning my own client's repo.**
That is commercial use. You or the client needs a licence.

**Are the rules themselves licensed?**
The rule catalogue, the threat model and the documentation are part of the
software and are covered by the same terms. The *findings* Toolward produces
about your own code are yours; do whatever you like with them.

**Does the licence restrict what I may scan?**
No. Toolward does static analysis on files you already have. Only scan things
you are authorised to audit — that is your responsibility, not the licence's.

## Contributions

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/)
and are licensed to the project under the same PolyForm terms, with the right
for the maintainers to offer them under commercial licences as well. See
[CONTRIBUTING.md](CONTRIBUTING.md).
