package object_store

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/tidwall/gjson"
	yaml "gopkg.in/yaml.v2"

	"github.com/deckhouse/deckhouse/testing/library"
)

type ErrObjectNotFound struct {
	message string
}

func (e *ErrObjectNotFound) Error() string {
	return e.message
}

type KubeObject map[string]interface{}

func (obj KubeObject) Field(path string) library.KubeResult {
	jsonBytes, _ := json.Marshal(obj)

	result := gjson.GetBytes(jsonBytes, path)

	return library.KubeResult{Result: result}
}

func (obj KubeObject) Parse() library.KubeResult {
	jsonBytes, _ := json.Marshal(obj)

	result := gjson.ParseBytes(jsonBytes)

	return library.KubeResult{Result: result}
}

func (obj KubeObject) ToYaml() string {
	yamlBytes, _ := yaml.Marshal(obj)

	return string(yamlBytes)
}

func (obj KubeObject) Exists() bool {
	return len(obj) > 0
}

type MetaIndex struct {
	Kind      string
	Namespace string
	Name      string
}

type ObjectStore map[MetaIndex]KubeObject

func (store ObjectStore) PutObject(object KubeObject, index MetaIndex) {
	store[normalizeMetaIndex(index)] = object
}

func (store ObjectStore) GetObject(index MetaIndex) (KubeObject, bool) {
	obj, ok := store[normalizeMetaIndex(index)]
	return obj, ok
}

func (store ObjectStore) DeleteObject(index MetaIndex) {
	delete(store, normalizeMetaIndex(index))
}

func (store ObjectStore) RetrieveObjectByMetaIndex(index MetaIndex) (object KubeObject, exists bool) {
	object, exists = store[index]

	return
}

func (store ObjectStore) KubernetesGlobalResource(kind, name string) KubeObject {
	metaIndex := normalizeMetaIndex(NewMetaIndex(kind, "", name))
	obj, _ := store.RetrieveObjectByMetaIndex(metaIndex)

	return obj
}

func (store ObjectStore) KubernetesResource(kind, namespace, name string) KubeObject {
	metaIndex := normalizeMetaIndex(NewMetaIndex(kind, namespace, name))
	obj, _ := store.RetrieveObjectByMetaIndex(metaIndex)

	return obj
}

func (store ObjectStore) ToYaml() string {
	var buf strings.Builder
	for _, object := range store {
		buf.WriteString("---\n")
		buf.WriteString(object.ToYaml())
	}

	return buf.String()
}

func NewMetaIndex(kind, namespace, name string) MetaIndex {
	return MetaIndex{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}
}

func normalizeMetaIndex(index MetaIndex) MetaIndex {
	r := regexp.MustCompile("(es|s)$")

	return MetaIndex{
		Kind:      strings.ToLower(r.ReplaceAllString(index.Kind, "")),
		Namespace: strings.ToLower(index.Namespace),
		Name:      strings.ToLower(index.Name),
	}
}
