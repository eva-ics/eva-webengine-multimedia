all:
	npm run build

bump:
	npm version --no-git-tag-version patch
	sed -i "s/\(const eva_webengine_multimedia_version\).*/\1 = \"`jq < package.json -r .version`\";/g" ./src/lib.ts

pub:
	rci x eva.webengine-multimedia

doc:
  rm -rf docs
  typedoc --plugin typedoc-plugin-missing-exports --skipErrorChecking --cacheBust
  cd docs && gsutil -m cp -a public-read -r . gs://pub.bma.ai/dev/docs/eva-webengine-multimedia/
