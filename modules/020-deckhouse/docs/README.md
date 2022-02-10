---
title: "The deckhouse module"
search: releaseChannel, release channel stabilization, auto-switching the release channel
---

In Deckhouse, this module sets up:
- The logging level;
- The set of features;
- The desirable release channel;
- Update windows;
- The update mode (Manual / Auto); 
- The service for validating custom resources that are managed by Deckhouse modules.

The bundle parameter specified in the [configuration](configuration.html#parameters-bundle) defines the set of enabled modules. The `Default` set is suitable for most cases. You can explicitly enable any additional modules in the configuration.

Setting the [releaseChannel](configuration.html#parameters-releasechannel) parameter in the configuration will cause Deckhouse to switch to the selected release channel if the Deckhouse versions in the current and target release channels are identical. This switching is not instantaneous and depends on how often the versions on the Deckhouse release channels change.
