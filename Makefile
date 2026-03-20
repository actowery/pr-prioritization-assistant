.PHONY: install build typecheck test test-build scan scan-dev clean clean-reports

install:
	npm install

build:
	npm run build

typecheck:
	npm run typecheck

test-build:
	npm run test:build

test:
	npm run test:build
	npm test

scan:
	npm run scan

scan-dev:
	npm run scan:dev

clean:
	npm run clean

clean-reports:
	npm run clean:reports
