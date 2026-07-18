# Merchant Verification and Payment-DM Brainstorm (Archived)

> **Status note (2026-07-08):** Historical brainstorm — kept for context, do not treat as current
> spec. Since written: the user-vs-enterprise signup role picker, subscription DMs with renewal
> receipts and resubscribe/cancel actions, and one-click cancellation are all live. Merchant
> "verified checkmark" verification remains an open idea (KYC/business verification plumbing exists
> — see [`../kyc-verification.md`](../kyc-verification.md)). The byte-for-byte duplicate
> `followxxx.txt` was removed during repository organization.

JUST MAKE AN IMPLEMENTATION PLAN!

Ok, here's a plan.

I want to introduce SubScript verifications.

This will be like a manual enterprise check and The merchant account will be verified by subscript (The enterprise will have like a green verified checkmark)

Here's my idea

there's currently just a dashboard for merchants, when someone clicks "Sign Up" the app should ask if the person is a user or an enterprise.

The merchant/enterprise dashboard should be the same as it currently is but the user dashboard should be different, this should be where the user can control their subscriptions and stuff and there should be like a dms submenu.

here's why; Say a user wants to subscribe to a popular merchant e.g Netflix, the user logs in and all, so when the user clicks on subscribe with subscript, then Netflix's backend stuff will generate a payment link that links the Netflix user with the subscript payment link generated, now that our backend can detect if payment is being made with the link so confirms onchain and user is subscribed.

here's where the dms comes in, if the user clicks the link and the connected wallet in the link is already a subscript user, the link will open as a dm of the merchant (In this case Netflix) with the details of what the user is paying for with a confirm or decline button to choose from if user confirms, backend does it's thing and the user is in, if user declines, backend does it's thing and user is rejected.

Here's the better part, when the 30d is up, and the user does not have usdc in their wallet, the user will receive a dm from the merchant with a resubscribe or cancel premium plan or option, the user decides, the user can also choose to cancel plan in the dms. Even if the user has usdc in their wallet, when the 30d is up and the usdc is debited, the user will get a dm also, so they'd know where the sudden debit is coming from.

I also want to add a feauture where a number of times a payment link can be used. so when user requests for funds and stuff, just one time will do

NB: these messages are  and should be automated, so a merchant can't be hacked and send scammy dms to the users. and the users can't chat either, it's just like a payment, request, receive, confirm, dm. 

with this update when a user clicks on any payment link and user is about to pay, the platform should have like a pop up (If the merchant is not verified) some warning so the user can make sure he knows he's not being scammed, if the merchant is verified, a different story

also with the dms function, users can also request from other users USDC via payment links (In dm form)

How can this be implemented and tell me how this idea sounds. 


Just create an implementation plan for now



When other pages are clicked e.g the premium page, it should not show up on the bottom bar, the bottom bar should go, there should be a back button at the top left to indicate going back to the home page 

The bottom bar should be a bit bigger (like the nav bar size) And the icons should also be bigger, I want when switching tabs with the bottom bar, the animation of the icons closing and opening should be animated (Make it feel like a 60fps experience) 


The subscript DNS, should be it's own section and the "DNS/wallet address" section of the page should lead there (There's a /*message*/ there, it shouldn't be)





The bars (nav bar and bottom bar) should be slightly bigger (Vertically).

The settlement portal, the popup does not have the same UI/UX feel as the entirety of the app fix that

For the batch payouts (when withdrawing), there should also be a tab instead of the csv, you can input addresses, one by one, in each designated section, like how the industrial payout does, choose amount of members you want to send money to, and input each addresses in the designated area 

Also I want to ask, how can one fund the vault, I want to just fund my vault and try out these features, like creating a sandbox environment with my API keys,  to fund my vault with some usdc to be used for testing

The bottom bar should not show up when user has not connected their wallet.

I also want to introduce profile photos for merchant and users, The page where the subscript dns is, the setting of profile pic and should show up there, 2MB maximum limit file size for pfp 

Add this to you implementation plan also

I've added a bunch of .otf and .ttf file Sukar is the name, so all the white texts in the site, change the font to the Sukar font 





Merchants shouldn't have the ".sub" DNS because all merchants can't have the same name because of laws

If a web2 product already have a payment method implemented, when Subscript is implemented, there should be a "Pay with SubScript" button, When user clicks, If the platform detects a wallet in it's browser, it should ask continue with wallet or generate payment link, if user uses browser wallet, the platform will connect wallet and pay, if the user has a subscript account, the dm will open but this time they won't be redirected, it will open when they scan the qr code or click the payment link the platform generates , also I want the dm recieved from the merchant be detailed, it should show time and date (as normal messaging platforms) show whom the payment is for, show what they are paying for, show amount, show amount, show duration and all...
