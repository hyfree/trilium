"use strict";

const Note = require('./note.js');
const AbstractEntity = require("./abstract_entity.js");
const sql = require("../../services/sql.js");
const dateUtils = require("../../services/date_utils.js");
const promotedAttributeDefinitionParser = require("../../services/promoted_attribute_definition_parser");

class Attribute extends AbstractEntity {
    static get entityName() { return "attributes"; }
    static get primaryKeyName() { return "attributeId"; }
    static get hashedProperties() { return ["attributeId", "noteId", "type", "name", "value", "isInheritable"]; }

    constructor(row) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row) {
        this.update([
            row.attributeId,
            row.noteId,
            row.type,
            row.name,
            row.value,
            row.isInheritable,
            row.position,
            row.utcDateModified
        ]);
    }

    update([attributeId, noteId, type, name, value, isInheritable, position, utcDateModified]) {
        /** @param {string} */
        this.attributeId = attributeId;
        /** @param {string} */
        this.noteId = noteId;
        /** @param {string} */
        this.type = type;
        /** @param {string} */
        this.name = name;
        /** @param {int} */
        this.position = position;
        /** @param {string} */
        this.value = value;
        /** @param {boolean} */
        this.isInheritable = !!isInheritable;
        /** @param {string} */
        this.utcDateModified = utcDateModified;

        return this;
    }

    init() {
        if (this.attributeId) {
            this.becca.attributes[this.attributeId] = this;
        }

        if (!(this.noteId in this.becca.notes)) {
            // entities can come out of order in sync, create skeleton which will be filled later
            this.becca.notes[this.noteId] = new Note({noteId: this.noteId});
        }

        this.becca.notes[this.noteId].ownedAttributes.push(this);

        const key = `${this.type}-${this.name.toLowerCase()}`;
        this.becca.attributeIndex[key] = this.becca.attributeIndex[key] || [];
        this.becca.attributeIndex[key].push(this);

        const targetNote = this.targetNote;

        if (targetNote) {
            targetNote.targetRelations.push(this);
        }
    }

    get isAffectingSubtree() {
        return this.isInheritable
            || (this.type === 'relation' && this.name === 'template');
    }

    get targetNoteId() { // alias
        return this.type === 'relation' ? this.value : undefined;
    }

    isAutoLink() {
        return this.type === 'relation' && ['internalLink', 'imageLink', 'relationMapLink', 'includeNoteLink'].includes(this.name);
    }

    get note() {
        return this.becca.notes[this.noteId];
    }

    get targetNote() {
        if (this.type === 'relation') {
            return this.becca.notes[this.value];
        }
    }

    /**
     * @returns {Note|null}
     */
    getNote() {
        return this.becca.getNote(this.noteId);
    }

    /**
     * @returns {Note|null}
     */
    getTargetNote() {
        if (this.type !== 'relation') {
            throw new Error(`Attribute ${this.attributeId} is not relation`);
        }

        if (!this.value) {
            return null;
        }

        return this.becca.getNote(this.value);
    }

    /**
     * @return {boolean}
     */
    isDefinition() {
        return this.type === 'label' && (this.name.startsWith('label:') || this.name.startsWith('relation:'));
    }

    getDefinition() {
        return promotedAttributeDefinitionParser.parse(this.value);
    }

    getDefinedName() {
        if (this.type === 'label' && this.name.startsWith('label:')) {
            return this.name.substr(6);
        } else if (this.type === 'label' && this.name.startsWith('relation:')) {
            return this.name.substr(9);
        } else {
            return this.name;
        }
    }

    beforeSaving() {
        if (!this.value) {
            if (this.type === 'relation') {
                throw new Error(`Cannot save relation ${this.name} since it does not target any note.`);
            }

            // null value isn't allowed
            this.value = "";
        }

        if (this.position === undefined) {
            // TODO: can be calculated from becca
            this.position = 1 + sql.getValue(`SELECT COALESCE(MAX(position), 0) FROM attributes WHERE noteId = ?`, [this.noteId]);
        }

        if (!this.isInheritable) {
            this.isInheritable = false;
        }

        this.utcDateModified = dateUtils.utcNowDateTime();

        super.beforeSaving();

        this.becca.attributes[this.attributeId] = this;
    }

    getPojo() {
        return {
            attributeId: this.attributeId,
            noteId: this.noteId,
            type: this.type,
            name: this.name,
            position: this.position,
            value: this.value,
            isInheritable: this.isInheritable,
            utcDateModified: this.utcDateModified,
            isDeleted: false
        };
    }

    createClone(type, name, value, isInheritable) {
        return new Attribute({
            noteId: this.noteId,
            type: type,
            name: name,
            value: value,
            position: this.position,
            isInheritable: isInheritable,
            utcDateModified: this.utcDateModified
        });
    }
}

module.exports = Attribute;
