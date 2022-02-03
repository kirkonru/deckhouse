---
title: "Как настроить?"
permalink: ru/
lang: ru
---

Deckhouse состоит из ядра (оператора Deckhouse) и модулей. Модуль может состоять из нескольких компонентов и может предоставлять WEB-интерфейс (при включении таких модулей будут создаваться соответствующие Ingress-ресурсы).  

Поведение Deckhouse настраивается с помощью:
- [Глобальных настроек](deckhouse-configure-global.html#параметры), хранящихся в параметре `global` [конфигурации Deckhouse](#конфигурация-deckhouse); 
- Настроек модулей, хранящихся в [конфигурации Deckhouse](#конфигурация-deckhouse) и **Custom resource'ах** (для некоторых модулей Deckhouse).

## Конфигурация Deckhouse

Конфигурация Deckhouse хранится в ConfigMap `deckhouse` в пространстве имен `d8-system` и может содержать следующие параметры (ключи):
- `global` —  содержит [глобальные настройки](deckhouse-configure-global.html) Deckhouse в виде multi-line-строки в формате YAML;
- `<moduleName>` (где `<moduleName>` — название модуля Deckhouse в camelCase) — содержит [настройки модуля](#настройка-модуля) в виде multi-line-строки в формате YAML;
- `<moduleName>Enabled` (где `<moduleName>` — название модуля Deckhouse в camelCase) — параметр позволяет явно [включить или отключить модуль](#включение-и-отключение-модуля).

> Для редактирования конфигурации Deckhouse выполните следующую команду:
> ```shell
> kubectl -n d8-system edit cm/deckhouse
> ```

При редактировании конфигурации обратите внимание на несколько важных нюансов:

* Символ `|` (вертикальная черта) обязательно должен быть указан, т.к. передаваемое значение — многострочная строка (multi-line string), а не объект;
* Наименование модулей пишется в стиле *camelCase*, при котором несколько слов пишутся слитно без пробелов, при этом каждое слово внутри фразы пишется с прописной буквы;

### Настройка модуля

> Ядро Deckhouse использует проект [addon-operator](https://github.com/flant/addon-operator/) при работе с [модулями](https://github.com/flant/addon-operator/blob/main/MODULES.md), [хуками модулей](https://github.com/flant/addon-operator/blob/main/HOOKS.md), [параметрами модулей](https://github.com/flant/addon-operator/blob/main/VALUES.md). Если вы хотите глубже понять архитектуру Deckhouse, познакомьтесь с проектом `addon-operator` (не забудьте поставить звезду проекту, если вам понравилось... Спасибо!).     

Deckhouse работает только с включёнными модулями. В зависимости от используемого [варианта поставки](./modules/020-deckhouse/configuration.html#parameters-bundle) модули могут быть включены или выключены по умолчанию. Читайте подробнее, про явное [включение или отключение модуля](#включение-и-отключение-модуля).  

Модуль настраивается в конфигурации Deckhouse в параметре с названием модуля в camelCase. Значением параметра передается multi-line-строка в формате YAML с настройками модуля.

Некоторые модули могут дополнительно настраиваться с помощью custom resource'ов. Перечень возможных настроек модуля в конфигурации Deckhouse и описание используемых им custom resource'ов можно найти в документации модуля (воспользуйтесь поиском по названию модуля или по названию custom resource на сайте).

Пример настройки параметров модуля `kube-dns`:
```yaml
data:
  kubeDns: |
    stubZones:
    - upstreamNameservers:
      - 192.168.121.55
      - 10.2.7.80
      zone: directory.company.my
    upstreamNameservers:
    - 10.2.100.55
    - 10.2.200.55
```

### Включение и отключение модуля

Для включения или отключения модуля необходимо добавить в ConfigMap `deckhouse` параметр `<moduleName>Enabled`, который может принимать одно из двух значений: `"true"` или `"false"` (кавычки обязательны), где `<moduleName>` — название модуля в camelCase.

Пример включения модуля `user-authn`:

```yaml
data:
  userAuthnEnabled: "true"
```

### Пример ConfigMap `deckhouse`

```yaml
apiVersion: v1
metadata:
  name: deckhouse
  namespace: d8-system
data:
  global: |          # Вертикальная черта.
    # глобальные настройки в формате YAML.
    modules:
      publicDomainTemplate: "%s.kube.company.my"
  # Настройки модуля monitoring-ping в формате YAML.
  monitoringPing: |
    externalTargets:
    - host: 8.8.8.8
  # Отключение модуля dashboard.
  dashboardEnabled: "false"   
```

## Выделение узлов под определенный вид нагрузки

Если в параметрах модуля не указаны явные значения `nodeSelector/tolerations`, то для всех модулей используется следующая стратегия:

1. Если параметр `nodeSelector` модуля не указан, то Deckhouse попытается вычислить `nodeSelector` автоматически. В этом случае, если в кластере присутствуют узлы с лейблами из определенного списка или лейблами определенного формата (читайте подробнее, под спойлером), то Deckhouse укажет их в качестве `nodeSelector` ресурсам модуля;
1. Если параметр `tolerations` модуля не указан, то Pod'ам модуля автоматически устанавливаются все возможные toleration'ы (читайте подробнее, под спойлером);
1. Отключить автоматическое вычисление параметров `nodeSelector` или `tolerations` можно указав значение `false`.

>**Важно!** Если модуль предполагает работу DaemonSet'a на всех узлах кластера (например, `cni-flannel`, `monitoring-ping`) или он должен работать на master-узлах (например, `prometheus-metrics-adapter` или некоторые компоненты `vertical-pod-autoscaler`) — то у таких модулей возможность настройки `nodeSelector` и `tolerations` отключена.

{% offtopic title="Особенности автоматики, зависящие от **типа** модуля" %}{% raw %}
* Модули *monitoring* (operator-prometheus, prometheus и vertical-pod-autoscaler):
  * Порядок поиска узлов (для определения nodeSelector):
    * Наличие узла с лейблом <code>node-role.deckhouse.io/MODULE_NAME</code>;
    * Наличие узла с лейблом <code>node-role.deckhouse.io/monitoring</code>;
    * Наличие узла с лейблом <code>node-role.deckhouse.io/system</code>;
  * Добавляемые toleration'ы (добавляются одновременно все):
    * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"MODULE_NAME"}</code>

      (Например: <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"operator-prometheus"}</code>);
    * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"monitoring"}</code>;
    * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"system"}</code>;
* Модули *frontend* (исключительно nginx-ingress):
    * Порядок поиска узлов (для определения nodeSelector):
        * Наличие узла с лейблом <code>node-role.deckhouse.io/MODULE_NAME</code>;
        * Наличие узла с лейблом <code>node-role.deckhouse.io/frontend</code>;
    * Добавляемые toleration'ы (добавляются одновременно все):
        * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"MODULE_NAME"}</code>;
        * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"frontend"}</code>;
* Все остальные модули:
    * Порядок поиска узлов (для определения nodeSelector):
        * Наличие узла с лейблом <code>node-role.deckhouse.io/MODULE_NAME</code> (Например: <code>node-role.deckhouse.io/cert-manager</code>);
        * Наличие узла с лейблом <code>node-role.deckhouse.io/system</code>;
    * Добавляемые toleration'ы (добавляются одновременно все):
        * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"MODULE_NAME"}</code> 
        
        (Например: <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"network-gateway"}</code>);
        * <code>{"key":"dedicated.deckhouse.io","operator":"Equal","value":"system"}</code>.
{% endraw %}
{% endofftopic %}
