# mockinterview.live: first traction and media plan

Prepared September 14, 2026. This is a proposed plan, not a record of campaigns run or results achieved. Assumptions: one founder, about eight hours per week for distribution and feedback, an initial $0–$300 budget, and separate time for product fixes. No production analytics or existing audience figures were available for this review.

**Recommendation: recruit a focused group of interview candidates, help them complete useful practice, turn their criticism into visible improvements, then pitch that story to larger audiences.** Run three acquisition experiments at a time. Start with founder LinkedIn, coach/community pilots, and short demonstrations reused on X. Give media a concrete demo, an original open-source artifact, and permissioned user experiences to cover.

## 1. Choose a clear first audience and promise

Start with **mid-career software engineers who expect an interview in the next 30 days**, especially people preparing to explain a project, defend a design choice, or reason about AI-generated work. Use the founder's strongest existing network to choose the first geography; no evidence yet supports spending across multiple countries or languages.

This is an initial audience hypothesis. The initial corpus snapshot contained 143 scenarios, with 90 tagged for software engineering and 51 for data science; these tags overlap. Most default scenario levels were mid/senior. These counts are a point-in-time audit of the existing collection, and should be rechecked against the deployed release before publication. Student channels can follow with a deliberately selected, practitioner-reviewed set of appropriate scenarios.

Suggested positioning:

> **Practice explaining your engineering decisions out loud.**
> An AI interviewer asks follow-up questions about your thinking, then gives you feedback tied to your answers. Practice by voice or text and leave with a specific next step.

Supporting details: open source; camera and resume optional; original scenarios; clearly identified AI; saved reports; feedback can mark missing evidence as “not assessed.” For public access, state **one funded interview every seven days, adults 18+**. Approved testers have a separate unlimited-start entitlement. Code and SQL receive text review; execution is not available.

“AI mock interview with follow-ups” alone is a crowded position: [Yoodli already advertises contextual follow-ups and reports](https://yoodli.ai/use-cases/interview-preparation). My inference is that explaining real engineering decisions, evidence-linked feedback, and inspectable original scenarios give this project a more specific story to test. This is not a verified uniqueness or superiority claim.

The first offer should be a small **Interview Practice Lab**: begin with 20 approved testers, one selected 15-minute scenario, an optional short debrief, and an invitation to retry after a fix. Admit subsequent small cohorts after checking reliability and provider spending. Ask for candid feedback; access must not depend on praise, reviews, sharing, or votes. Existing tester access has no interview-start quota, so cohort size and usage need operational attention.

## 2. Make the first visit explain the value

The live homepage returned HTTP 200 on September 14. It says “A little practice. A clearer next step.” and explains the weekly allowance. Its HTML contained a title and description but no canonical, Open Graph, or Twitter-card metadata. Both `/robots.txt` and `/sitemap.xml` returned 404. A missing robots file does **not** itself block indexing. The catalog's initial HTML showed a loading state rather than scenario content.

Prioritize these improvements before a broad launch:

| Priority | Proposed change | Purpose / acceptance evidence |
|---|---|---|
| First | Put the focused promise, one 45–60 second real demo, and a fictional example report on the landing page | A new visitor can explain the product and see the quality of feedback before registering |
| First | Feature three suitable scenarios: explain a project, defend a design decision, critique AI output | Reduce catalog choice overload; a practitioner checks each scenario and example report |
| First | Add a clear pilot application/contact route; keep public allowance visible | Candidates can request tester access without assuming everyone has unlimited usage |
| First | Observe five fresh users from signup through email verification, device check, interview, and report | Record where they need help and fix the most common obstacle; include voice and text, desktop and a supported mobile browser |
| First | Capture campaign attribution and the activation funnel | Distinguish clicks from people who reach a useful report |
| Next | Add social preview metadata/image, canonical URLs, sitemap, intentional crawl rules, and Search Console verification | Shared links explain the product; inspect indexing in Search Console rather than infer it from a search query |
| Next | Publish three useful, indexable scenario guides with examples and links into practice | Give searchers useful content before login; start with quality rather than 143 near-identical pages |
| Next | Refresh the public README: remove the starter-project preamble, put demo and try links first, reconcile public docs with the deployed release | Make the open-source story easy to inspect |

Google explains that [sitemaps help discovery but do not guarantee crawling or indexing](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview). Social previews and search improvements are proposed work; this strategy did not implement them.

## 3. Acquisition experiments, in priority order

Effort estimates below are planning estimates, excluding product development. Channels have different purposes: a developer launch can find bugs and contributors without establishing demand among active job seekers.

| Channel | Concrete first experiment | Effort | What would justify more effort? |
|---|---|---|---|
| **Founder LinkedIn** | Three posts a week for two weeks: product demo, worked interview example, and a specific change prompted by a tester. Invite people with interviews coming up into the pilot. Use a product Page for identity and the founder profile for conversation. | 90 min/week | At least five target users reach a report and three give specific feedback over two weeks |
| **Interview coaches / recruiters / engineering mentors** | Identify ten relevant people through existing connections or their public professional contact route. Propose a 20-minute audit of one scenario and a five-person client pilot. Ask what practice their clients lack between coaching sessions. | 2 hours initially | Two agree to try it, and at least one wants to use it again after seeing reports |
| **Organizer-led communities** | Offer two small clinics to a trusted engineering group, alumni network, or suitable SWE group. Organizer introduces it; participants get a demonstration, individual practice, and optional discussion. | 1–2 hours/clinic | Participants complete practice and an organizer requests a repeat session or introduces another organizer |
| **X / Twitter** | Reserve an available product handle and consistent display name. Pin the demo and accurate free allowance. Post three short examples a week, reusing LinkedIn material with platform-appropriate wording. Join relevant conversations with useful answers. | 45 min/week | Five qualified completed reports in a two-week test; otherwise reduce it to a maintained product presence |
| **Short video** | Make three 30–60 second clips: “defend this design decision,” “the follow-up that exposed a vague answer,” and “turn one report comment into a better explanation.” Reuse on X, LinkedIn, YouTube Shorts; test Reels/TikTok only if the relevant audience responds. | Batch 90 min | Viewers take the specific next step and complete practice, not only watch |
| **Reddit beta/building communities** | One substantive, disclosed maker post in r/sideprojects; consider r/alphaandbetausers after checking current requirements. Include the demo, limits, and two precise questions. | 45 min + replies | Three reproducible problems or five relevant users; builder interest is a separate result from job-seeker demand |
| **Show HN** | A working demo, source, and technical explanation of evidence-linked feedback. Be present to discuss limitations and implementation. | Half-day preparation | Useful technical critique, practitioner review, or qualified practice users |
| **Product Hunt** | One prepared launch after the first cohorts: clear use case, screenshots, short demo, founder comment, and truthful beta limits. | Half-day + launch replies | Attributable interview completions and later return; rank is a secondary signal |
| **Search / evergreen guides** | Three original pages: explaining your engineering project; defending a system-design tradeoff; critiquing an AI-generated solution. Each includes a worked example and a relevant practice CTA. | 2 hours/page | Impressions for relevant queries, then completed interviews; evaluate over 6–12 weeks rather than the first few days |
| **Open-source contribution** | Publish a useful original scenario collection and ask three practitioners to review named rubric sections. Write an engineering walkthrough for DEV or the project blog. | 2–3 hours | Meaningful reviews or contributions; track separately from candidate activation |
| **Personal referrals** | After someone identifies a useful next step, ask whether one friend preparing for an interview would benefit. Start with a plain link; later consider opt-in sharing of a scenario or practice takeaway. | 15 min/week | Referred friends actually complete practice; do not build a referral system before this works manually |
| **Paid distribution** | After activation works, test one tightly relevant small creator or newsletter with a fixed spend limit and its own campaign link. Request independent evaluation. | Later | Cost per completed report fits a consciously chosen budget and produces useful feedback |

Use the first three as the active acquisition experiments. X can reuse the same content without becoming a fourth major workstream. The remaining rows are a queue, not a requirement to launch everywhere at once.

Specific community prospects:

- [SWE Early Career Professionals](https://earlycareerprofessionalsag.swe.org/): relevant to the first ten years of a career; choose a software-relevant subgroup and scenario with the organizer.
- [ColorStack involvement](https://www.colorstack.org/get-involved): propose a small adult-member clinic through organizers; review scenario level before recruitment.
- [UCLA ACM](https://acm.cs.ucla.edu/) and [UCSD ACM](https://acmucsd.com/): potential student-club pilots after selecting suitable entry-level content. Their published contact routes are available on their official sites.
- [CodePath career services](https://www.codepath.org/career-services): a later prospect with existing interview support; learn the unmet need before proposing a complementary pilot.

These are researched prospects, not partnerships or permission to promote inside their communities. Prioritize warm introductions over the prestige of an organization.

Platform rules that change the tactics:

- [r/cscareerquestions rules](https://www.reddit.com/r/cscareerquestions/wiki/posting_rules/) prohibit promotional posts and comments; surveys require moderator approval. Exclude direct promotion there.
- [r/sideprojects](https://www.reddit.com/r/sideprojects/) permits substantive project sharing subject to its rules. The plural name matters; recheck the exact community before posting. The [freeCodeCamp forum](https://forum.freecodecamp.org/guidelines) is not a general launch-link channel.
- [Show HN](https://news.ycombinator.com/showhn.html) wants something people can try, ideally without signup/email barriers. A genuinely interactive, no-account sample would help; current hosted practice still requires verified email. Do not solicit votes.
- [Product Hunt posting guidance](https://help.producthunt.com/en/articles/479557-how-to-post-a-product) explains launch setup; its [promotion rules](https://www.producthunt.com/launch/sharing-your-launch) prohibit asking for or incentivizing upvotes. A paid hunter is unnecessary.
- [X authenticity rules](https://help.x.com/en/rules-and-policies/authenticity) prohibit inauthentic amplification and spam tactics. Build through demonstrations and relevant conversation.

## 4. Build a story media can use

The most promising angle to test is **“Can you explain the work you built with AI?”** Show an original work-sample or AI-output critique scenario, a real product demonstration, and a practitioner's view of the feedback. Present this as a concrete candidate problem; it does not establish that every employer is adopting a new interview format.

Two additional angles: **an open-source interview tool that shows the evidence behind its feedback**, and **what a small pilot revealed about useful and misleading AI interview feedback**. A specific failure and the resulting fix can be more useful editorial material than a feature announcement.

| Target | Material to offer | Timing and route |
|---|---|---|
| **Changelog News** | A noteworthy open-source scenario release or evidence-citation design, with repository and public examples | After the artifact is ready. [Submission rules](https://changelog.com/news/submit) allow own-work submissions but exclude commercial product pitches and tutorials; pitch genuine open-source news |
| **freeCodeCamp News** | A practical original article about explaining engineering decisions, with worked examples and a restrained final CTA | An editorial contribution, not a press release. Its [style guide](https://www.freecodecamp.org/news/developer-news-style-guide/) requires approved authors, forbids ghostwriting/branded accounts, and allows limited final promotion. Tejo should personally author it |
| **The Hustle: How You Hustle** | Founder experience backed by real pilot observations, failures, and dated usage counts | After a credible pilot. [Founder feature route](https://thehustle.co/how-you-hustle-founder-startup-feature); selection is discretionary |
| **Smaller career creators / interview coaches** | An independent “coach audits AI feedback” session or a demonstration of practicing between human sessions | Start with five carefully matched people from a manually screened list of 15; an agreement to review does not imply audience promotion |
| **Jeff H Sipe / Practice Interviews** | A bounded expert review of a scenario and report | A relevant named prospect via his [professional profile](https://www.linkedin.com/in/jeffhsipe); interest and availability unverified |
| **Jeff Su** | A career-focused demonstration or comparison with independent criticism | Later stretch prospect. His [official site](https://www.jeffsu.org/) lists partnership routes; sponsorship is paid distribution, not earned coverage. Fees are unverified |
| **Founder’s alumni or local technology publication** | A local founder story connected to an actual community clinic and permissioned participant interviews | Select only after confirming the founder's relevant institution/location; those details were not assumed here |

A practical readiness threshold: a working demo, roughly 50 users who reached a report, at least 20 product responses, two or three permissioned quotes, and a practitioner willing to explain strengths and limitations. These are internal planning gates, not media acceptance requirements. A particularly useful open-source release can be pitched sooner.

Prepare a small public media kit: 60–90 second demo; three screenshots; fictional sample interview/report; plain product description; current allowance; founder bio/photo; source link; contact route; dated pilot notes. Add only quotes approved for publication. Existing permission to inspect a transcript for support does not authorize publishing it.

Pitch five closely matched editors/creators individually. Refer to an actual relevant piece, offer one finding and supporting material, and follow up once after about a week. Early priorities are focused publications and credible practitioners. Broad press-release syndication and expensive general-audience sponsorships should wait for evidence that visitors activate.

## 5. Make feedback the growth loop

The application already has a six-question post-interview check-in and private `/admin/feedback` aggregates. Use the existing dimensions: ease, realism, probing quality, challenge fit, report actionability, and disruption. Standard users must complete the check-in before another interview; approved testers can skip it. Do not equate high mandatory completion with enthusiasm or measure tester/public return as one cohort.

Add a short optional debrief around three questions:

1. What were you preparing for, and what would you have used otherwise?
2. Show me one useful or wrong moment in the interview/report.
3. What would make you choose this again before your interview?

Capture one next action the person plans to practice. Ask willing participants to retry a changed scenario and explain what improved or remained wrong. Invite people who got stuck to a debrief as well as those who finished. Pay any usability stipend for their time, independent of sentiment and public endorsement.

Each week, group findings into onboarding, interview behavior, and report usefulness. Choose the highest-impact problem, fix it, and show the change to willing testers. Publish a small “You tried it; here is what changed” example using fictional or publication-approved material. This produces useful content and a reason to return.

## 6. Measure useful practice and channel quality

**Primary measure: unique new users who complete an interview and open its report.** Call this activation. Track repeat practice and feedback alongside it. Followers, visitors, mentions, and stars explain reach but cannot substitute for activation.

Proposed first-month targets, not forecasts: **50 activated users, 30 completed product check-ins, 10 optional debriefs, 15 returning testers, and two organizers/coaches interested in another cohort.** Revise after the first 20 users. “Returning” here means a second completed interview within 14 days of the first, measured only after each person's full follow-up window has elapsed.

| Funnel / result | Definition |
|---|---|
| Qualified recruitment | Adult in the target role with an interview expected within 30 days; record from optional pilot intake |
| Signup and verification | Unique accounts created and verified, attributed where possible to a campaign |
| Interview start | Actual server-recorded start; exclude unused reservations |
| Activation | First completed interview plus report opened; deduplicate by user |
| Feedback coverage | Submitted check-ins / eligible attempts, following the existing instrument definitions |
| Actionability | Favorable report-actionability answers / rated answers; show counts and unavailable/unread/unrated responses separately |
| Repeat use | Second completed interview within 14 days, using mature cohorts and separate tester/public-access groups |
| Acquisition efficiency | Attributable spend and founder hours / activated users; record provider spending separately too |
| Reliability | Started attempts producing usable reports, failures/retries, and reported disruption; do not silently discard failures |

The repository review did not find a full acquisition funnel or persistent UTM attribution. A tracking URL alone does not implement tracking. Proposed events are `landing_view`, `signup_completed`, `email_verified`, `interview_started`, `interview_completed`, `report_opened`, and `feedback_submitted`; repeat use is derived from actual completed sessions. Use a minimal disclosed implementation, deduplicate events, and keep resumes, answers, transcripts, and emails out of analytics payloads and URLs.

Suggested URL convention: `https://mockinterview.live/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=practice_lab_202609&utm_content=demo_01`. Give each organizer and creative its own stable code. Until capture exists, keep a private manual pilot roster with a volunteered “where did you hear about this?” response. Treat self-report as approximate attribution.

Log each experiment with: hypothesis, audience, asset/link, hours, spend, visitors if known, verified signups, activated users, feedback, mature-cohort return, and next decision. After two weeks, keep a channel that produces relevant completions and specific feedback. If a campaign produces 20 qualified visits but zero starts, inspect the promise and onboarding before buying more traffic. Small samples guide next experiments; they do not establish precise channel rankings.

Suggested readiness checks before a larger traffic push: at least 20 real starts observed; at least 80% producing reports; at least ten rated actionability responses with 70% favorable; major recurring failures addressed. These are provisional founder decision thresholds, not validated industry benchmarks or proof of interview readiness.

Use [the project's feedback metric definitions](FEEDBACK-METRICS.md). Public pilot claims must disclose timeframe, recruitment, participants versus attempts, response coverage, and limitations. AI scores and self-reported usefulness do not establish improved hiring outcomes.

## 7. Thirty-day execution calendar

| Window | Work | Deliverable / decision |
|---|---|---|
| **Days 1–3** | Select the audience and three scenarios; prepare a demo/report; draft profiles and pinned post; define attribution; arrange the first five observed trials | A specific offer and a working first-use path; any product changes handled as separate implementation work |
| **Days 4–7** | Begin founder LinkedIn/X content; approach ten relevant coaches/organizers; recruit up to 20 approved testers in small batches | Five observed sessions, one practitioner review, list of top friction points and measured provider use |
| **Days 8–14** | Run two small practice clinics or remote cohorts; gather debriefs; fix the top problems; publish one transparent update | First usable cohort results; decide which acquisition sources deserve another week |
| **Days 15–21** | Invite retries; publish the best scenario guide; run one permitted Reddit post or Show HN launch when ready | Evidence of repeat use, a clearer positioning statement, additional feedback/contributions |
| **Days 22–30** | Publish a dated pilot summary; approach five focused media/creator targets; prepare Product Hunt if activation is healthy | Media kit, tailored pitches, next-month decision based on completed practice |

If reliability or activation remains weak, use the fourth week to improve the next cohort rather than force a calendar-driven launch. If one channel works early, give it more time instead of adding more platforms.

An eight-hour recurring week: three hours of sessions and debriefs; two hours of content; one hour of organizer/coach outreach; one hour of feedback analysis; one hour of replies and planning. Product engineering and initial asset setup need additional time.

Illustrative $300 allocation: $100 provider/hosting headroom, $150 for ten optional $15 usability debriefs, $50 reserve. Actual provider cost per completed session is unknown; measure it before promising broad free usage. With no cash budget, recruit volunteer testers and use existing hosting capacity. With a larger budget, fund more observed sessions and one narrow creator experiment after activation works. No spending is authorized by this plan.

## 8. Beyond the first month

Keep the strongest audience and channel until recruitment becomes repeatable. Then test an adjacent audience, such as data professionals, with reviewed scenarios and distinct reporting. Build a referral/share feature only after people voluntarily recommend the product; share a scenario or chosen takeaway without exposing private reports by default. Consider a weekly practice email only for people who opt in, timed to their allowance. Community-maintained scenario packs, recurring organizer clinics, and evergreen practice guides can each compound over time.

The operating sequence is: **useful demonstration → relevant candidate → completed practice → specific feedback → visible improvement → retry or referral → stronger story for wider distribution.**

Companion: [draft launch posts, invitations, and pitches](GROWTH-LAUNCH-KIT-2026-09-14.md).
