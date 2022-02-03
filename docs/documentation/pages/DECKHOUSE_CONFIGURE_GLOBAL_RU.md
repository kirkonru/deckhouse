---
title: "Глобальные настройки"
permalink: ru/deckhouse-configure-global.html
lang: ru
---

Глобальные настройки Deckhouse хранятся в параметре `global` [конфигурации Deckhouse](./#конфигурация-deckhouse).

На основе шаблона, указанного в параметре [publicDomainTemplate](#parameters-modules-publicdomaintemplate), некоторые модули автоматически создают Ingress-ресурсы. Если вы используете модули, которые создают Ingress-ресурсы для WEB-интерфейсов или других целей (например, [user-authn](modules/150-user-authn/), у вас должен быть настроен параметр `publicDomainTemplate` и выполнена настройка DNS в соответствии с указанным шаблоном (либо прописаны статические записи локально, например в файле `/etc/hosts` для Linux).

> Если у вас нет возможности заводить wildcard-записи DNS, для целей тестирования вы можете воспользоваться сервисом [nip.io](https://nip.io) или аналогами.
> Обратите внимание на [важные нюансы](./#конфигурация-deckhouse) заполнения ConfigMap `deckhouse`.

## Параметры

{{ site.data.schemas.global.config-values | format_configuration }}
